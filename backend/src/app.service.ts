import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  Acceptance,
  AcceptanceItemResult,
  AcceptanceResult,
  AllowanceRecord,
  AllowanceStatus,
  AllowanceType,
  BudgetItem,
  CloseRecord,
  ConstructionLog,
  ConstructionPlan,
  ConstructionTeam,
  Consultation,
  DifficultyType,
  EvacuationPerson,
  EvacuationRecord,
  EvacuationState,
  FamilyProfile,
  House,
  HouseActivity,
  HouseStatus,
  Inspection,
  IssueRecord,
  IssueStatus,
  IssueType,
  ItemStatus,
  NoticeRecord,
  PersonMoveStatus,
  PersonRole,
  RectificationItem,
  RecheckRecord,
  ReviewPlan,
  RiskLevel,
  Shelter,
  Stakeholder,
  SubsidyApplication,
  SubsidyStatus,
  User,
} from './entities';
import { evaluateRisk } from './risk.rules';

const SUBSIDY_RATE = 0.7; // 补助不超过核定预算的70%
const SUBSIDY_CAP = 50000; // 每户最高补助5万元

export interface CurrentUser {
  sub: string;
  username: string;
  name: string;
  role: string;
  township?: string;
  teamId?: string;
}

@Injectable()
export class AppService {
  constructor(
    @InjectRepository(House) private houses: Repository<House>,
    @InjectRepository(Inspection) private inspections: Repository<Inspection>,
    @InjectRepository(ReviewPlan) private plans: Repository<ReviewPlan>,
    @InjectRepository(RectificationItem) private items: Repository<RectificationItem>,
    @InjectRepository(NoticeRecord) private notices: Repository<NoticeRecord>,
    @InjectRepository(EvacuationRecord) private evacuations: Repository<EvacuationRecord>,
    @InjectRepository(Stakeholder) private stakeholders: Repository<Stakeholder>,
    @InjectRepository(Consultation) private consultations: Repository<Consultation>,
    @InjectRepository(IssueRecord) private issues: Repository<IssueRecord>,
    @InjectRepository(FamilyProfile) private families: Repository<FamilyProfile>,
    @InjectRepository(ConstructionTeam) private teams: Repository<ConstructionTeam>,
    @InjectRepository(ConstructionPlan) private cplans: Repository<ConstructionPlan>,
    @InjectRepository(BudgetItem) private budgetItems: Repository<BudgetItem>,
    @InjectRepository(SubsidyApplication) private subsidies: Repository<SubsidyApplication>,
    @InjectRepository(ConstructionLog) private logs: Repository<ConstructionLog>,
    @InjectRepository(Acceptance) private acceptances: Repository<Acceptance>,
    @InjectRepository(AcceptanceItemResult) private results: Repository<AcceptanceItemResult>,
    @InjectRepository(CloseRecord) private closes: Repository<CloseRecord>,
    @InjectRepository(RecheckRecord) private rechecks: Repository<RecheckRecord>,
    @InjectRepository(HouseActivity) private activities: Repository<HouseActivity>,
    @InjectRepository(Shelter) private shelters: Repository<Shelter>,
    @InjectRepository(EvacuationPerson) private evacPersons: Repository<EvacuationPerson>,
    @InjectRepository(AllowanceRecord) private allowances: Repository<AllowanceRecord>,
    @InjectRepository(User) private users: Repository<User>,
    private dataSource: DataSource,
  ) {}

  // ---------- 工具 ----------
  async logActivity(houseId: string, kind: string, title: string, detail: string, u?: CurrentUser) {
    await this.activities.save(
      this.activities.create({
        houseId,
        kind,
        title,
        detail,
        operatorId: u?.sub,
        operatorName: u?.name,
      }),
    );
  }

  async openBlockingIssues(houseId: string): Promise<IssueRecord[]> {
    return this.issues.find({ where: { houseId, blocksWorkflow: true, status: In([IssueStatus.OPEN, IssueStatus.RESOLVING]) } });
  }

  async assertNoBlocking(houseId: string, action: string) {
    const list = await this.openBlockingIssues(houseId);
    if (list.length) {
      throw new BadRequestException(
        `存在 ${list.length} 件未解决的阻断性问题（${list.map((i) => issueTypeLabel(i.type)).join('、')}），无法${action}；请先协商处理并办结`,
      );
    }
  }

  async getHouseOrFail(id: string) {
    const h = await this.houses.findOne({ where: { id } });
    if (!h) throw new NotFoundException('房屋档案不存在');
    return h;
  }

  async latestPlan(houseId: string) {
    const plans = await this.plans.find({ where: { houseId }, order: { reviewedAt: 'DESC' }, relations: ['items'] });
    return plans[0] || null;
  }

  async latestValidClose(houseId: string) {
    const c = await this.closes.findOne({ where: { houseId }, order: { closedAt: 'DESC' } });
    return c && !c.revoked ? c : null;
  }

  // ---------- 人员转移清册聚合 ----------
  async rosterSummary(houseId: string, exec?: any) {
    const repo = exec ? exec.getRepository(EvacuationPerson) : this.evacPersons;
    const persons: EvacuationPerson[] = await repo.find({ where: { houseId }, order: { registeredAt: 'ASC' } });
    const registered = persons.length;
    const resettled = persons.filter((p) => p.moveStatus === PersonMoveStatus.RESETTLED).length;
    const stillOnSite = persons.filter((p) => p.moveStatus === PersonMoveStatus.STILL_ON_SITE).length;
    const returned = persons.filter((p) => p.moveStatus === PersonMoveStatus.RETURNED).length;
    const continuingBusiness = persons.filter((p) => p.continueBusiness).length;
    const evacuated = resettled; // 已确认离开并安置
    let state: EvacuationState = EvacuationState.NONE;
    if (registered > 0) {
      if (returned > 0) state = EvacuationState.RETURNED;
      else if (evacuated >= registered) state = EvacuationState.FULL;
      else state = EvacuationState.PARTIAL;
    }
    return {
      registered, resettled, stillOnSite, returned, evacuated, continuingBusiness,
      total: registered, state,
      full: state === EvacuationState.FULL,
      incomplete: registered > 0 && state !== EvacuationState.FULL,
    };
  }

  /**
   * 依据清册现场核对结果重算房屋转移状态（同一事件内反复核对，不新建档案）：
   * - 有人擅自返回 → REBOUND 同事件续办；
   * - 登记 N 人仅 M<N 人确认离开 → EVACUATING 转移中，不得清退；
   * - 全员离开 → EVACUATED 已清退。
   */
  async recomputeEvacuationState(exec: any, house: House) {
    const summary = await this.rosterSummary(house.id, exec);
    house.fullEvacuationConfirmed = summary.full;
    house.businessClosed = summary.full && summary.continuingBusiness === 0;
    if (summary.state === EvacuationState.RETURNED) {
      house.status = HouseStatus.REBOUND;
    } else if (summary.state === EvacuationState.PARTIAL) {
      house.status = HouseStatus.EVACUATING;
    } else if (summary.state === EvacuationState.FULL) {
      house.status = HouseStatus.EVACUATED;
      house.stopUseConfirmed = true;
    }
    await exec.save(house);
    // 全员清退/续办解除时，自动办结此前的“人员未全部清退”督办留痕
    if (summary.state === EvacuationState.FULL || summary.state === EvacuationState.RETURNED) {
      await exec.update(
        IssueRecord,
        { houseId: house.id, type: IssueType.EVACUATION_INCOMPLETE, status: IssueStatus.OPEN },
        {
          status: IssueStatus.RESOLVED,
          resolution: summary.state === EvacuationState.FULL ? '现场逐人复核，登记人员已全部离开并安置' : '转为擅自返回续办处置',
          resolvedAt: new Date(),
        },
      );
    }
    return summary;
  }

  /** 闸口：要求全员转移清退（开工/验收/销号/拨付共用） */
  async assertFullEvacuation(house: House, action: string) {
    const plan = await this.latestPlan(house.id);
    if (!plan?.evacuationRequired) return;
    const summary = await this.rosterSummary(house.id);
    if (summary.registered === 0) {
      throw new BadRequestException(`应转移人员尚未建立转移清册并经现场核对，不能${action}`);
    }
    if (summary.state === EvacuationState.RETURNED) {
      throw new BadRequestException(`现场核查发现转移人员擅自返回/偷营业，已按原事件重新纳入治理，不能${action}；请先处置并重新核对清册`);
    }
    if (!summary.full) {
      throw new BadRequestException(
        `登记${summary.registered}人、现场仅确认${summary.evacuated}人离开（仍在现场${summary.stillOnSite}人${summary.continuingBusiness ? `，其中${summary.continuingBusiness}人继续经营` : ''}），未全部清退，不能${action}`,
      );
    }
  }

  /** 闸口：存在未撤销的有效销号（补助拨付、复营业等销号后环节共用） */
  async assertValidClose(houseId: string, action: string) {
    const close = await this.latestValidClose(houseId);
    if (!close) throw new BadRequestException(`房屋没有有效的销号结论（旧销号已撤销/尚未销号），不能${action}`);
    return close;
  }

  // ---------- 巡查 ----------
  async createInspection(u: CurrentUser, body: any) {
    const required = ['township', 'village', 'address', 'ownerName', 'buildYear', 'floors'];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === '') {
        throw new BadRequestException(`字段 ${f} 不能为空`);
      }
    }
    const { level, reasons } = evaluateRisk({
      buildYear: Number(body.buildYear),
      floors: Number(body.floors),
      isBusiness: !!body.isBusiness,
      isRented: !!body.isRented,
      isAddedFloor: !!body.isAddedFloor,
      wallCrack: Number(body.wallCrack || 0),
      roofLeak: Number(body.roofLeak || 0),
      foundationSettlement: Number(body.foundationSettlement || 0),
      residents: Number(body.residents || 0),
      rainSeason: !!body.rainSeason,
    });

    return this.dataSource.transaction(async (m) => {
      let house: House;
      if (body.houseId) {
        house = await m.findOne(House, { where: { id: body.houseId } });
        if (!house) throw new NotFoundException('房屋档案不存在');
      } else if (body.code) {
        house = await m.findOne(House, { where: { code: body.code } });
      }
      if (!house) {
        const code = body.code || `NF-${body.township.slice(0, 2)}-${Date.now().toString().slice(-6)}`;
        if (await m.findOne(House, { where: { code } })) throw new BadRequestException('档案编号已存在');
        house = m.create(House, { code });
      }
      Object.assign(house, {
        township: body.township,
        village: body.village,
        address: body.address,
        lng: body.lng ?? house.lng,
        lat: body.lat ?? house.lat,
        ownerName: body.ownerName,
        idCard: body.idCard ?? house.idCard,
        ownerPhone: body.ownerPhone ?? house.ownerPhone,
        buildYear: Number(body.buildYear),
        floors: Number(body.floors),
        usage: body.usage || '住宅',
        isBusiness: !!body.isBusiness,
        isRented: !!body.isRented,
        isAddedFloor: !!body.isAddedFloor,
        wallCrack: Number(body.wallCrack || 0),
        roofLeak: Number(body.roofLeak || 0),
        foundationSettlement: Number(body.foundationSettlement || 0),
        residents: Number(body.residents || 0),
        riskLevel: level,
        ruleReasons: reasons,
      });
      // 复查中反弹的房屋再次巡查且有风险 -> 重新进入待复核；已销号房屋巡查出新风险 -> 待复核
      if ([HouseStatus.CLOSED, HouseStatus.REBOUND].includes(house.status) && level !== RiskLevel.NORMAL) {
        house.status = HouseStatus.PENDING_REVIEW;
      } else if (!house.status || house.status === HouseStatus.CLOSED) {
        house.status = HouseStatus.PENDING_REVIEW;
      }
      house = await m.save(house);

      const insp = await m.save(
        m.create(Inspection, {
          houseId: house.id,
          inspectorId: u.sub,
          inspectorName: u.name,
          inspectedAt: body.inspectedAt ? new Date(body.inspectedAt) : new Date(),
          buildYear: house.buildYear,
          floors: house.floors,
          usage: house.usage,
          isBusiness: house.isBusiness,
          isRented: house.isRented,
          isAddedFloor: house.isAddedFloor,
          wallCrack: house.wallCrack,
          roofLeak: house.roofLeak,
          foundationSettlement: house.foundationSettlement,
          residents: house.residents,
          rainSeason: !!body.rainSeason,
          riskLevel: level,
          reasons,
          photos: body.photos || [],
          notes: body.notes || null,
        }),
      );

      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'INSPECTION',
          title: `巡查登记 · ${riskLabel(level)}`,
          detail: reasons.join('；'),
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      if (body.rainSeason && (level === RiskLevel.SUSPEND || level === RiskLevel.EVACUATE)) {
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.RAIN_SEASON,
            description: '雨季/强降雨后房屋险情加重，需加密监测并优先处置',
            status: IssueStatus.RESOLVING,
            blocksWorkflow: false, // 雨季是加严因素而非整改阻断项
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
      }
      return { house, inspection: insp };
    });
  }

  // ---------- 乡镇复核与整改方案 ----------
  async createReview(u: CurrentUser, body: any) {
    const insp = await this.inspections.findOne({ where: { id: body.inspectionId } });
    if (!insp) throw new BadRequestException('巡查记录不存在');
    const house = await this.getHouseOrFail(insp.houseId);
    if (![HouseStatus.PENDING_REVIEW, HouseStatus.REBOUND].includes(house.status)) {
      throw new BadRequestException('当前房屋状态不允许复核（仅待复核/反弹重新治理可复核）');
    }
    if (!body.items || !body.items.length) throw new BadRequestException('整改方案至少包含一个整改项');
    const decision: RiskLevel = body.decision || insp.riskLevel;

    return this.dataSource.transaction(async (m) => {
      const plan = await m.save(
        m.create(ReviewPlan, {
          houseId: house.id,
          inspectionId: insp.id,
          reviewerId: u.sub,
          reviewerName: u.name,
          reviewedAt: new Date(),
          decision,
          requirement: body.requirement || '',
          deadline: body.deadline,
          stopUseRequired: !!body.stopUseRequired || decision === RiskLevel.SUSPEND || decision === RiskLevel.EVACUATE,
          evacuationRequired: !!body.evacuationRequired || decision === RiskLevel.EVACUATE,
        }),
      );
      for (const it of body.items) {
        await m.save(
          m.create(RectificationItem, {
            planId: plan.id,
            type: it.type,
            description: it.description,
            required: it.required !== false,
            status: ItemStatus.PENDING,
          }),
        );
      }
      house.status = HouseStatus.IN_PLAN;
      house.riskLevel = decision;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'REVIEW',
          title: `乡镇复核 · ${riskLabel(decision)}，下达整改方案（${body.items.length}项，期限 ${body.deadline}）`,
          detail: body.requirement || '',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return m.findOne(ReviewPlan, { where: { id: plan.id }, relations: ['items'] });
    });
  }

  // ---------- 风险告知 ----------
  async createNotice(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('尚未形成复核整改方案，不能进行风险告知');
    if (!body.notifiedTo || !body.notifiedTo.length) throw new BadRequestException('请选择被告知对象');
    // 紧急转移/暂停使用房屋，告知必须签收，方可进入后续环节
    if ((plan.evacuationRequired || plan.stopUseRequired) && !body.acknowledged) {
      throw new BadRequestException('该房屋需暂停使用/紧急转移，风险告知必须由被告知人签收确认');
    }
    const notice = await this.notices.save(
      this.notices.create({
        houseId: house.id,
        planId: plan.id,
        method: body.method || '现场告知',
        notifiedTo: body.notifiedTo,
        notifiedAt: new Date(body.notifiedAt || Date.now()),
        acknowledged: !!body.acknowledged,
        signPhotos: body.signPhotos || [],
        content: body.content || plan.requirement,
        recorderId: u.sub,
      }),
    );
    house.status = HouseStatus.NOTIFIED;
    await this.houses.save(house);
    await this.logActivity(house.id, 'NOTICE', `风险告知（${notice.method}）`, `被告知人：${body.notifiedTo.join('、')}；${body.acknowledged ? '已签收' : '未签收'}`, u);
    return notice;
  }

  // ---------- 停用确认 / 人员转移 ----------
  async confirmStopUse(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    const plan = await this.latestPlan(houseId);
    if (!plan) throw new BadRequestException('尚未下达整改方案');
    if (!plan.stopUseRequired && !plan.evacuationRequired) {
      throw new BadRequestException('方案未要求暂停使用，无需封停确认');
    }
    const ackNotice = await this.notices.findOne({ where: { houseId }, order: { notifiedAt: 'DESC' } });
    if (!ackNotice || !ackNotice.acknowledged) {
      throw new BadRequestException('风险告知未签收，不得采取封停措施');
    }
    house.stopUseConfirmed = !!body.confirmed;
    if (!plan.evacuationRequired) house.status = HouseStatus.STOPPED;
    await this.houses.save(house);
    await this.logActivity(houseId, 'NOTICE', body.confirmed ? '房屋已封停/设置警示，确认暂停使用' : '停用确认被撤销', body.remark || '', u);
    return { ok: true };
  }

  async createEvacuation(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('尚未下达整改方案');
    if (!plan.evacuationRequired && !body.force) {
      throw new BadRequestException('该房屋方案未要求紧急转移；如情况紧急请由乡镇确认后登记');
    }
    if (Number(body.residents) <= 0) throw new BadRequestException('转移人数必须大于0');
    if (!body.destination) throw new BadRequestException('请填写安置去向');
    const ackNotice = await this.notices.findOne({ where: { houseId: house.id }, order: { notifiedAt: 'DESC' } });
    if (!ackNotice?.acknowledged && !body.force) {
      throw new BadRequestException('风险告知未签收，不能登记转移（特殊情况可由乡镇强制处置并注明）');
    }
    return this.dataSource.transaction(async (m) => {
      const rec = await m.save(
        m.create(EvacuationRecord, {
          houseId: house.id,
          residents: Number(body.residents),
          destination: body.destination,
          photos: body.photos || [],
          settledAt: new Date(body.settledAt || Date.now()),
          allowReturn: false,
          recorderId: u.sub,
          remark: body.remark || '',
        }),
      );
      // 批量转移登记：随单列出的人员直接建入清册并视为现场确认离开；
      // 清册中其余人员仍按其现场核对状态计算，避免“登记即全员销号”。
      if (body.persons && Array.isArray(body.persons) && body.persons.length) {
        for (const p of body.persons) {
          await m.save(
            m.create(EvacuationPerson, {
              houseId: house.id,
              name: p.name,
              phone: p.phone || null,
              role: p.role || PersonRole.RESIDENT,
              moveStatus: PersonMoveStatus.RESETTLED,
              shelterName: p.shelterName || body.destination,
              shelterId: p.shelterId || null,
              settledFrom: p.settledFrom || new Date().toISOString().slice(0, 10),
              continueBusiness: false,
              photos: p.photos || body.photos || [],
              registeredAt: new Date(),
              verifiedAt: new Date(),
              verifiedById: u.sub,
              verifiedByName: u.name,
            }),
          );
        }
      }
      await this.recomputeEvacuationState(m, house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'EVACUATE',
          title: `紧急转移安置 ${rec.residents} 人 → ${rec.destination}`,
          detail: '验收通过并销号前，转移人员不得擅自返回；清册未全员确认离开不得清退',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return rec;
    });
  }

  // ---------- 安置点 ----------
  listShelters(township?: string) {
    return this.shelters.find({ where: township ? { township } : {}, order: { township: 'ASC', name: 'ASC' } });
  }

  async createShelter(body: any) {
    if (!body.name) throw new BadRequestException('安置点名称不能为空');
    const t = this.shelters.create({
      name: body.name,
      township: body.township || null,
      address: body.address || null,
      contact: body.contact || null,
      phone: body.phone || null,
      capacity: Number(body.capacity || 0),
    });
    return this.shelters.save(t);
  }

  // ---------- 转移人员清册 ----------
  async registerRoster(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    const persons: any[] = body.persons || [];
    if (!persons.length) throw new BadRequestException('请至少登记一名应转移人员');
    for (const p of persons) {
      if (!p.name) throw new BadRequestException('每名人员都须填写姓名');
    }
    return this.dataSource.transaction(async (m) => {
      for (const p of persons) {
        await m.save(
          m.create(EvacuationPerson, {
            houseId,
            name: p.name,
            phone: p.phone || null,
            role: p.role || PersonRole.RESIDENT,
            moveStatus: PersonMoveStatus.REGISTERED,
            registeredAt: new Date(),
          }),
        );
      }
      // 建立清册即进入“转移中”；是否清退以逐人现场核对为准
      if ([HouseStatus.NOTIFIED, HouseStatus.STOPPED].includes(house.status)) {
        house.status = HouseStatus.EVACUATING;
      }
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId,
          kind: 'EVACUATE',
          title: `建立转移人员清册：登记 ${persons.length} 人`,
          detail: persons.map((p) => `${p.name}（${personRoleLabel(p.role || PersonRole.RESIDENT)}）`).join('、'),
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { ok: true };
    });
  }

  /** 网格员现场逐人核对：安置点、起始安置日期、照片、是否继续经营、当前状态 */
  async verifyRosterPerson(u: CurrentUser, personId: string, body: any) {
    const p = await this.evacPersons.findOne({ where: { id: personId } });
    if (!p) throw new NotFoundException('清册中无此人员');
    if (!body.moveStatus || !(Object.values(PersonMoveStatus) as string[]).includes(body.moveStatus)) {
      throw new BadRequestException('请给出该人员现场核对结论（已安置/仍在现场/擅自返回）');
    }
    if (body.moveStatus === PersonMoveStatus.RESETTLED) {
      if (!body.shelterName && !body.shelterId) throw new BadRequestException('已离开人员必须登记安置去向/安置点');
      if (!body.settledFrom) throw new BadRequestException('必须登记从哪天开始安置');
      if (!body.photos || !body.photos.length) throw new BadRequestException('现场核对必须留存照片（人在安置点或封停现场）');
    }
    p.moveStatus = body.moveStatus;
    p.phone = body.phone ?? p.phone;
    p.role = body.role || p.role;
    p.shelterId = body.shelterId ?? p.shelterId;
    p.shelterName = body.shelterName ?? p.shelterName;
    p.settledFrom = body.settledFrom ?? p.settledFrom;
    if (body.moveStatus === PersonMoveStatus.RETURNED) p.returnedAt = new Date();
    if (body.moveStatus === PersonMoveStatus.RESETTLED) {
      p.continueBusiness = false; // 已离开并安置，不可能继续在现场经营
      p.returnedAt = null;
    } else if (body.moveStatus === PersonMoveStatus.STILL_ON_SITE) {
      p.continueBusiness = !!body.continueBusiness;
    }
    if (body.photos) p.photos = body.photos;
    if (body.remark !== undefined) p.remark = body.remark;
    p.verifiedAt = new Date();
    p.verifiedById = u.sub;
    p.verifiedByName = u.name;

    const house = await this.getHouseOrFail(p.houseId);
    return this.dataSource.transaction(async (m) => {
      await m.save(p);
      const summary = await this.recomputeEvacuationState(m, house);
      const actionText: Record<string, string> = {
        RESETTLED: '确认已离开并入住安置点',
        STILL_ON_SITE: '现场核对仍在房屋内',
        RETURNED: '现场核查发现擅自返回',
        REGISTERED: '重新标记为已登记待核对',
      };
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'EVACUATE',
          title: `现场核对：${p.name} ${actionText[body.moveStatus] || '已核对'}`,
          detail: [
            p.shelterName ? `去向：${p.shelterName}` : '',
            p.settledFrom ? `自 ${p.settledFrom} 起安置` : '',
            p.continueBusiness ? '仍在继续经营' : '',
            p.remark || '',
          ].filter(Boolean).join('；') || '现场核对',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      // 登记6人仅确认5人离开等“未全部清退”情形：留痕为督办异常（硬闸口在开工/销号环节拦截）
      if (summary.incomplete && summary.state === EvacuationState.PARTIAL) {
        const exists = await m.findOne(IssueRecord, {
          where: { houseId: house.id, type: IssueType.EVACUATION_INCOMPLETE, status: IssueStatus.OPEN },
        });
        if (!exists) {
          await m.save(
            m.create(IssueRecord, {
              houseId: house.id,
              type: IssueType.EVACUATION_INCOMPLETE,
              description: `转移清册登记${summary.registered}人，现场仅确认${summary.evacuated}人离开，仍有${summary.stillOnSite}人在现场，房屋不得清退`,
              status: IssueStatus.OPEN,
              blocksWorkflow: false,
              raisedById: u.sub,
              raisedByName: u.name,
              raisedAt: new Date(),
            }),
          );
        }
      }
      return { ok: true, summary };
    });
  }

  /** 整改期间/销号后现场核查：发现偷偷返回/继续经营 → 同一事件续办（不新建记录），旧销号失效 */
  async duringRectificationRecheck(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    if (![HouseStatus.RECTIFYING, HouseStatus.ACCEPTANCE_FAILED, HouseStatus.REBOUND, HouseStatus.EVACUATED, HouseStatus.EVACUATING, HouseStatus.CLOSED].includes(house.status)) {
      throw new BadRequestException('当前状态不支持现场核查（须已进入转移/整改/销号后的同一事件）');
    }
    return this.dataSource.transaction(async (m) => {
      const hitReturn = !!body.foundReturn;
      const hitOperating = !!body.foundOperating;
      const foundOnSite = Number(body.foundOnSite || 0);
      const returnedNames: string[] = [];
      if (Array.isArray(body.personIds) && body.personIds.length) {
        for (const pid of body.personIds) {
          const p = await m.findOne(EvacuationPerson, { where: { id: pid } });
          if (p) {
            p.moveStatus = PersonMoveStatus.RETURNED;
            p.returnedAt = new Date();
            if (hitOperating) p.continueBusiness = true;
            await m.save(p);
            returnedNames.push(p.name);
          }
        }
      }
      const fail = hitReturn || hitOperating || foundOnSite > 0;
      await m.save(
        m.create(RecheckRecord, {
          houseId: house.id,
          phase: 'DURING_RECTIFICATION',
          result: fail ? AcceptanceResult.FAIL : AcceptanceResult.PASS,
          reboundNotes: body.notes || '',
          photos: body.photos || [],
          foundOnSite,
          foundOperating: hitOperating,
          checkedAt: new Date(),
          inspectorId: u.sub,
          inspectorName: u.name,
        }),
      );
      if (fail) {
        const desc = `整改期间现场核查：${foundOnSite ? `发现${foundOnSite}人仍在房屋内，` : ''}${hitReturn ? `转移人员擅自返回（${returnedNames.join('、') || '见照片'}），` : ''}${hitOperating ? '存在偷偷继续经营，' : ''}按原事件继续处理，不新建记录。${body.notes || ''}`;
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.PERSON_RETURN,
            description: desc,
            status: IssueStatus.OPEN,
            blocksWorkflow: true,
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
        // 撤销既有销号结论，旧销号不得继续有效
        const close = await m.findOne(CloseRecord, { where: { houseId: house.id }, order: { closedAt: 'DESC' } });
        if (close && !close.revoked) {
          close.revoked = true;
          close.revokedAt = new Date();
          close.revokedById = u.sub;
          close.revokeReason = desc;
          await m.save(close);
        }
        // 收回复营业准许；人员状态由 recompute 置为续办
        house.resumeBusinessApproved = false;
        await this.recomputeEvacuationState(m, house); // 有人 RETURNED → REBOUND 同事件续办
        // 现场发现有人但无法点名（foundOnSite>0）同样按反弹续办
        if ([HouseStatus.CLOSED, HouseStatus.EVACUATED, HouseStatus.RECTIFYING, HouseStatus.ACCEPTANCE_FAILED].includes(house.status)) {
          house.status = HouseStatus.REBOUND;
          await m.save(house);
        }
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id,
            kind: 'RECHECK',
            title: '整改期间现场核查发现偷返/偷营业：原事件续办，旧销号（如有）撤销',
            detail: desc,
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      } else {
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id,
            kind: 'RECHECK',
            title: '整改期间现场核查：未见人员返回、未发现偷营业',
            detail: body.notes || '',
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      }
      return { ok: true, foundViolation: fail };
    });
  }

  /** 处置偷返后再次现场核对：人员重新离开、全员安置后才允许办结续办异常 */
  async resolveReturnAndReverify(u: CurrentUser, issueId: string, body: any) {
    const issue = await this.issues.findOne({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('异常不存在');
    if (issue.type !== IssueType.PERSON_RETURN) throw new BadRequestException('仅偷返经营异常适用该处置');
    if (!body.resolution) throw new BadRequestException('办结必须填写处置结果（劝返安置点情况）');
    return this.dataSource.transaction(async (m) => {
      if (Array.isArray(body.personIds) && body.personIds.length) {
        for (const pid of body.personIds) {
          const p = await m.findOne(EvacuationPerson, { where: { id: pid } });
          if (p && p.houseId === issue.houseId) {
            p.moveStatus = PersonMoveStatus.RESETTLED;
            p.returnedAt = null;
            p.continueBusiness = false;
            p.shelterName = body.shelterName || p.shelterName;
            p.settledFrom = body.settledFrom || p.settledFrom;
            if (body.photos) p.photos = body.photos;
            p.verifiedAt = new Date();
            p.verifiedById = u.sub;
            p.verifiedByName = u.name;
            await m.save(p);
          }
        }
      }
      const house = await m.findOne(House, { where: { id: issue.houseId } });
      const summary = await this.recomputeEvacuationState(m, house);
      if (!summary.full) {
        throw new BadRequestException(`仍有${summary.stillOnSite + summary.returned}人未重新安置，不能办结偷返异常`);
      }
      issue.status = IssueStatus.RESOLVED;
      issue.resolution = body.resolution;
      issue.resolvedAt = new Date();
      await m.save(issue);
      await m.save(
        m.create(HouseActivity, {
          houseId: issue.houseId,
          kind: 'ISSUE',
          title: '偷返人员已劝回安置点并全员复核，续办异常办结',
          detail: body.resolution,
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { ok: true, summary };
    });
  }

  // ---------- 安置补助 / 经营损失 ----------
  async listAllowances(houseId: string) {
    return this.allowances.find({ where: { houseId }, order: { createdAt: 'DESC' } });
  }

  async applyAllowance(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    if (!(Object.values(AllowanceType) as string[]).includes(body.type)) {
      throw new BadRequestException('补助类型不合法');
    }
    if (!(Number(body.amount) > 0)) throw new BadRequestException('申请金额必须大于0');
    if (body.type === AllowanceType.RESETTLEMENT && !body.basis) {
      throw new BadRequestException('安置补助须填写核算依据（人天×标准）');
    }
    if (body.type === AllowanceType.BUSINESS_LOSS) {
      if (!house.isBusiness) throw new BadRequestException('该房屋未登记经营，不能申请经营损失补偿');
      if (!body.basis) throw new BadRequestException('经营损失须填写停业天数、日损失等核算依据');
    }
    const rec = await this.allowances.save(
      this.allowances.create({
        houseId,
        type: body.type,
        personId: body.personId || null,
        amount: Number(body.amount).toFixed(2),
        basis: body.basis,
        proof: body.proof || [],
        status: AllowanceStatus.APPLIED,
      }),
    );
    await this.logActivity(
      houseId,
      'SUBSIDY',
      body.type === AllowanceType.RESETTLEMENT ? `安置补助申请 ¥${rec.amount}` : `经营损失补偿申请 ¥${rec.amount}`,
      body.basis,
      u,
    );
    return rec;
  }

  async reviewAllowance(u: CurrentUser, id: string, body: any) {
    const rec = await this.allowances.findOne({ where: { id } });
    if (!rec) throw new NotFoundException();
    if (rec.status !== AllowanceStatus.APPLIED) throw new BadRequestException('仅待核定的申请可审核');
    const approved = !!body.approved;
    rec.status = approved ? AllowanceStatus.APPROVED : AllowanceStatus.REJECTED;
    rec.reviewComment = body.comment || (approved ? '核定通过，待房屋销号后拨付' : '核定不通过');
    rec.reviewedById = u.sub;
    rec.reviewedAt = new Date();
    if (approved) {
      const amt = Math.min(Number(body.approvedAmount || rec.amount), Number(rec.amount));
      if (!(amt > 0)) throw new BadRequestException('核定金额必须大于0');
      rec.approvedAmount = amt.toFixed(2);
    }
    await this.allowances.save(rec);
    await this.logActivity(
      rec.houseId,
      'SUBSIDY',
      rec.status === AllowanceStatus.APPROVED
        ? `${rec.type === AllowanceType.RESETTLEMENT ? '安置补助' : '经营损失'}已核定 ¥${rec.approvedAmount}（销号后拨付）`
        : `${rec.type === AllowanceType.RESETTLEMENT ? '安置补助' : '经营损失'}核定未通过`,
      rec.reviewComment,
      u,
    );
    return rec;
  }

  async payAllowance(u: CurrentUser, id: string) {
    const rec = await this.allowances.findOne({ where: { id } });
    if (!rec) throw new NotFoundException();
    if (rec.status !== AllowanceStatus.APPROVED) throw new BadRequestException('仅已核定通过的申请可拨付');
    // 拨付闸口：必须全员转移且销号有效；人员未清退或旧销号被撤销一律停拨
    const house = await this.getHouseOrFail(rec.houseId);
    await this.assertFullEvacuation(house, '拨付安置补助/经营损失');
    await this.assertValidClose(rec.houseId, '拨付安置补助/经营损失');
    rec.status = AllowanceStatus.PAID;
    rec.paidAt = new Date();
    await this.allowances.save(rec);
    await this.logActivity(rec.houseId, 'SUBSIDY', `安置/经营补助资金已拨付 ¥${rec.approvedAmount}`, '全员转移且销号有效后拨付', u);
    return rec;
  }

  /** 准许复营业：销号有效、阻断问题办结；随后经营者方可恢复营业 */
  async approveResumeBusiness(u: CurrentUser, houseId: string, body: any = {}) {
    const house = await this.getHouseOrFail(houseId);
    if (!house.isBusiness) throw new BadRequestException('该房屋未登记经营');
    await this.assertValidClose(houseId, '准许复营业');
    await this.assertNoBlocking(houseId, '准许复营业');
    if (house.resumeBusinessApproved) throw new BadRequestException('该房屋已准许复营业');
    return this.dataSource.transaction(async (m) => {
      house.resumeBusinessApproved = true;
      house.resumeBusinessAt = new Date();
      house.businessClosed = false;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId,
          kind: 'CLOSE',
          title: `准许恢复经营（${body.condition ? '附条件：' + body.condition : '已确认安全'}）`,
          detail: body.remark || '',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { ok: true };
    });
  }


  // ---------- 利益相关方 / 协商 / 异常 ----------
  async upsertStakeholder(houseId: string, body: any) {
    const rec = body.id
      ? await this.stakeholders.findOne({ where: { id: body.id } })
      : this.stakeholders.create({ houseId });
    if (!rec) throw new NotFoundException();
    Object.assign(rec, {
      type: body.type,
      name: body.name,
      phone: body.phone,
      stance: body.stance,
      influenceNote: body.influenceNote,
    });
    return this.stakeholders.save(rec);
  }

  async createConsultation(u: CurrentUser, body: any) {
    if (!body.outcome) throw new BadRequestException('请记录协商结果');
    const c = await this.consultations.save(
      this.consultations.create({
        houseId: body.houseId,
        topic: body.topic || '整改进度协商',
        attendeeIds: body.attendeeIds || [],
        outcome: body.outcome,
        heldAt: new Date(body.heldAt || Date.now()),
        recorderId: u.sub,
      }),
    );
    await this.logActivity(body.houseId, 'CONSULT', `多方协商：${c.topic}`, body.outcome, u);
    return c;
  }

  async raiseIssue(u: CurrentUser, body: any) {
    if (!body.type || !body.description) throw new BadRequestException('问题类型和描述不能为空');
    const issue = await this.issues.save(
      this.issues.create({
        houseId: body.houseId,
        type: body.type,
        description: body.description,
        status: IssueStatus.OPEN,
        blocksWorkflow: body.blocksWorkflow !== false,
        raisedById: u.sub,
        raisedByName: u.name,
        raisedAt: new Date(),
      }),
    );
    await this.logActivity(body.houseId, 'ISSUE', `异常上报：${issueTypeLabel(body.type)}`, body.description, u);
    return issue;
  }

  async setIssueStatus(u: CurrentUser, id: string, status: IssueStatus, resolution?: string) {
    const issue = await this.issues.findOne({ where: { id } });
    if (!issue) throw new NotFoundException();
    if (status === IssueStatus.RESOLVED && !resolution) {
      throw new BadRequestException('办结问题必须填写处置结果');
    }
    issue.status = status;
    if (resolution) issue.resolution = resolution;
    if (status === IssueStatus.RESOLVED) issue.resolvedAt = new Date();
    await this.issues.save(issue);
    await this.logActivity(
      issue.houseId,
      'ISSUE',
      status === IssueStatus.RESOLVED ? `问题办结：${issueTypeLabel(issue.type)}` : `问题处理中：${issueTypeLabel(issue.type)}`,
      resolution || '',
      u,
    );
    return issue;
  }

  // ---------- 家庭与权属 ----------
  async upsertFamily(houseId: string, body: any) {
    let f = await this.families.findOne({ where: { houseId } });
    if (!f) f = this.families.create({ houseId });
    Object.assign(f, {
      difficultyType: body.difficultyType || DifficultyType.NONE,
      difficultyProof: body.difficultyProof || [],
      ownershipType: body.ownershipType || '自有',
      ownershipProof: body.ownershipProof || [],
      ownerConsent: !!body.ownerConsent,
      membersNote: body.membersNote || '',
    });
    return this.families.save(f);
  }

  // ---------- 施工队 ----------
  listTeams() {
    return this.teams.find();
  }
  async createTeam(body: any) {
    if (!body.name) throw new BadRequestException('施工队名称不能为空');
    const t = this.teams.create({
      name: body.name,
      qualificationNo: body.qualificationNo || '',
      qualificationDoc: body.qualificationDoc || [],
      qualified: !!body.qualified,
      contact: body.contact,
      phone: body.phone,
      scope: body.scope,
    });
    return this.teams.save(t);
  }

  // ---------- 施工计划与预算 ----------
  async submitConstructionPlan(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('乡镇尚未形成整改方案');
    await this.assertNoBlocking(house.id, '提交施工计划');

    // 告知制约
    const notice = await this.notices.findOne({ where: { houseId: house.id }, order: { notifiedAt: 'DESC' } });
    if (!notice) throw new BadRequestException('尚未进行风险告知，不能开工');
    if ((plan.stopUseRequired || plan.evacuationRequired) && !notice.acknowledged) {
      throw new BadRequestException('风险告知未签收，不能开工');
    }
    // 停用/转移制约：方案要求紧急转移的，清册必须全员现场确认离开
    if (plan.evacuationRequired) {
      await this.assertFullEvacuation(house, '开工');
    } else if (plan.stopUseRequired && !house.stopUseConfirmed) {
      throw new BadRequestException('房屋尚未确认停用，不能开工');
    }
    // 户主同意
    const fam = await this.families.findOne({ where: { houseId: house.id } });
    if (!fam?.ownerConsent) throw new BadRequestException('户主尚未签署整改同意书（家庭情况登记中确认）');

    // 施工队资质
    const team = await this.teams.findOne({ where: { id: body.teamId } });
    if (!team) throw new BadRequestException('请选择施工队');
    if (!team.qualified || !team.qualificationNo) {
      throw new BadRequestException(`施工队「${team.name}」资质无效或已过期，不得承担农房加固施工`);
    }

    // 预算明细
    if (!body.budgetItems || !body.budgetItems.length) throw new BadRequestException('请填写预算明细');
    let total = 0;
    for (const b of body.budgetItems) {
      if (!b.name || !(Number(b.qty) > 0) || !(Number(b.unitPrice) >= 0)) {
        throw new BadRequestException('预算明细存在空项或非法数量/单价');
      }
      total += Number(b.qty) * Number(b.unitPrice);
    }

    return this.dataSource.transaction(async (m) => {
      let cplan = await m.findOne(ConstructionPlan, { where: { houseId: house.id } });
      if (cplan) {
        await m.delete(BudgetItem, { planId: cplan.id });
      } else {
        cplan = m.create(ConstructionPlan, { houseId: house.id });
      }
      cplan.teamId = team.id;
      cplan.teamName = team.name;
      cplan.startDate = body.startDate;
      cplan.endDate = body.endDate;
      cplan.budgetTotal = total.toFixed(2);
      cplan.description = body.description || '';
      cplan = await m.save(cplan);
      for (const b of body.budgetItems) {
        const amount = Number(b.qty) * Number(b.unitPrice);
        await m.save(
          m.create(BudgetItem, {
            planId: cplan.id,
            name: b.name,
            spec: b.spec || '',
            qty: Number(b.qty),
            unit: b.unit,
            unitPrice: Number(b.unitPrice).toFixed(2),
            amount: amount.toFixed(2),
          }),
        );
      }
      house.status = HouseStatus.RECTIFYING;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'PLAN',
          title: `施工计划与预算已提交（施工队：${team.name}，预算 ¥${total.toFixed(2)}）`,
          detail: `工期 ${body.startDate} 至 ${body.endDate}；共 ${body.budgetItems.length} 项明细`,
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return m.findOne(ConstructionPlan, { where: { id: cplan.id }, relations: ['budgetItems'] });
    });
  }

  // ---------- 补助申请（资格校验闸）----------
  async computeSubsidyGuards(house: House): Promise<{ passed: boolean; label: string; ok: boolean; message: string }[]> {
    const fam = await this.families.findOne({ where: { houseId: house.id } });
    const cplan = await this.cplans.findOne({ where: { houseId: house.id }, relations: ['budgetItems'] });
    const plan = await this.latestPlan(house.id);
    const notice = await this.notices.findOne({ where: { houseId: house.id }, order: { notifiedAt: 'DESC' } });
    const team = cplan?.teamId ? await this.teams.findOne({ where: { id: cplan.teamId } }) : null;
    const budget = cplan ? Number(cplan.budgetTotal) : 0;

    const guards = [
      {
        label: '家庭困难类型',
        ok: !!fam && fam.difficultyType !== DifficultyType.NONE,
        message: !fam ? '未登记家庭情况' : fam.difficultyType === DifficultyType.NONE ? '未认定困难类型，不符合补助条件' : `已认定：${difficultyLabel(fam.difficultyType)}`,
      },
      {
        label: '困难证明材料',
        ok: !!fam && (fam.difficultyProof?.length || 0) > 0,
        message: fam?.difficultyProof?.length ? `已上传 ${fam.difficultyProof.length} 份` : '缺少民政部门困难证明',
      },
      {
        label: '房屋权属证明',
        ok: !!fam && (fam.ownershipProof?.length || 0) > 0,
        message: fam?.ownershipProof?.length ? `已上传 ${fam.ownershipProof.length} 份` : '缺少不动产权证/宅基地使用证明',
      },
      {
        label: '户主整改同意',
        ok: !!fam?.ownerConsent,
        message: fam?.ownerConsent ? '户主已签署同意书' : '户主尚未同意整改',
      },
      {
        label: '整改方案与告知',
        ok: !!plan && !!notice,
        message: plan ? (notice ? '方案已下达并已告知' : '方案已下达但尚未告知') : '乡镇尚未下达整改方案',
      },
      {
        label: '高风险房屋停用/转移',
        ok: !plan || ((!plan.stopUseRequired || house.stopUseConfirmed) && (!plan.evacuationRequired ? true : false)) ||
          (plan.evacuationRequired && !!(await this.evacuations.findOne({ where: { houseId: house.id } }))),
        message: !plan?.evacuationRequired ? (plan?.stopUseRequired ? (house.stopUseConfirmed ? '已确认停用' : '应停用但未确认停用') : '方案未要求停用') : (await this.evacuations.findOne({ where: { houseId: house.id } })) ? '人员已转移安置' : '应紧急转移但尚未安置',
      },
      {
        label: '预算明细',
        ok: !!cplan && cplan.budgetItems.length > 0 && budget > 0,
        message: cplan ? (cplan.budgetItems.length ? `预算 ${cplan.budgetItems.length} 项，合计 ¥${budget.toFixed(2)}` : '预算明细为空') : '未提交施工预算',
      },
      {
        label: '施工队资质',
        ok: !!team?.qualified && !!team?.qualificationNo,
        message: team ? (team.qualified ? `${team.name}（资质 ${team.qualificationNo}）` : `${team.name} 资质失效`) : '未选定施工队',
      },
    ];
    return guards.map((g) => ({ ...g, passed: g.ok }));
  }

  async submitSubsidy(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    const guards = await this.computeSubsidyGuards(house);
    const allPass = guards.every((g) => g.ok);
    const cplan = await this.cplans.findOne({ where: { houseId } });
    const budget = cplan ? Number(cplan.budgetTotal) : 0;
    const maxAmount = Math.min(Math.round(budget * SUBSIDY_RATE), SUBSIDY_CAP);
    const amount = Math.min(Number(body.amount || 0), maxAmount);

    let app = await this.subsidies.findOne({ where: { houseId } });
    if (!app) app = this.subsidies.create({ houseId });
    app.amount = amount.toFixed(2);
    app.difficultyType = body.difficultyType || app.difficultyType || DifficultyType.NONE;
    app.guardResults = guards;
    app.planId = (await this.latestPlan(houseId))?.id;
    app.status = allPass ? SubsidyStatus.SUBMITTED : SubsidyStatus.DRAFT;
    app.reviewComment = allPass ? null : '资格校验未全部通过，退回补充材料';
    app = await this.subsidies.save(app);

    await this.logActivity(
      houseId,
      'SUBSIDY',
      allPass ? `补助申请已提交（¥${amount.toFixed(2)}，待乡镇复核）` : '补助申请资格校验未通过，退回补充',
      guards.filter((g) => !g.ok).map((g) => `${g.label}：${g.message}`).join('；') || '全部校验通过',
      u,
    );
    return { application: app, allPass, maxAmount };
  }

  async reviewSubsidy(u: CurrentUser, id: string, body: any) {
    const app = await this.subsidies.findOne({ where: { id } });
    if (!app) throw new NotFoundException();
    if (app.status !== SubsidyStatus.SUBMITTED) throw new BadRequestException('仅待复核的申请可审批');
    const disputes = await this.issues.find({
      where: { houseId: app.houseId, type: IssueType.SUBSIDY_DISPUTE, status: In([IssueStatus.OPEN, IssueStatus.RESOLVING]) },
    });
    if (disputes.length && body.approved) {
      throw new BadRequestException('该户存在未办结的补助资格争议，不得批准补助');
    }
    app.status = body.approved ? SubsidyStatus.APPROVED : SubsidyStatus.REJECTED;
    app.reviewComment = body.comment || (body.approved ? '资格符合，同意补助' : '复核不通过');
    app.reviewedById = u.sub;
    app.reviewedAt = new Date();
    await this.subsidies.save(app);
    await this.logActivity(app.houseId, 'SUBSIDY', body.approved ? `补助申请已批准 ¥${app.amount}（验收销号后发放）` : '补助申请被驳回', app.reviewComment, u);
    return app;
  }

  async getSubsidyByHouse(houseId: string) {
    const app = await this.subsidies.findOne({ where: { houseId } });
    if (!app) throw new NotFoundException('该房屋暂无补助申请');
    return app;
  }

  /** 发放：必须在验收通过且销号有效（未被复查撤销）后，申请已批准、人员全员清退 */
  async paySubsidy(u: CurrentUser, id: string) {
    const app = await this.subsidies.findOne({ where: { id } });
    if (!app) throw new NotFoundException();
    if (app.status !== SubsidyStatus.APPROVED) throw new BadRequestException('仅已批准的申请可发放');
    const house = await this.getHouseOrFail(app.houseId);
    await this.assertFullEvacuation(house, '发放补助');
    await this.assertValidClose(app.houseId, '发放补助');
    app.status = SubsidyStatus.PAID;
    app.paidAt = new Date();
    await this.subsidies.save(app);
    await this.logActivity(app.houseId, 'SUBSIDY', `补助资金已发放 ¥${app.amount}`, '验收销号有效、人员全员清退后发放', u);
    return app;
  }

  // ---------- 施工过程 ----------
  async addConstructionLog(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const cplan = await this.cplans.findOne({ where: { houseId: house.id }, relations: ['budgetItems'] });
    if (!cplan) throw new BadRequestException('尚未提交施工计划');
    if (u.role === 'TEAM' && u.teamId && cplan.teamId !== u.teamId) {
      throw new ForbiddenException('该房屋不是本施工队承接的项目');
    }
    if (house.status === HouseStatus.CLOSED) throw new BadRequestException('房屋已销号');

    // 材料核验：实际材料名称/规格必须能在预算明细中找到，否则判定偷换材料
    let materialVerified = true;
    let swapDetail = '';
    if (body.materialName) {
      const hit = cplan.budgetItems.find(
        (b) => b.name === body.materialName && (!b.spec || !body.materialSpec || b.spec === body.materialSpec),
      );
      materialVerified = !!hit;
      if (!hit) {
        swapDetail = `现场使用「${body.materialName} ${body.materialSpec || ''}」与预算/方案列明材料不一致`;
      }
    }

    return this.dataSource.transaction(async (m) => {
      const log = await m.save(
        m.create(ConstructionLog, {
          houseId: house.id,
          stage: body.stage,
          content: body.content,
          materialName: body.materialName || null,
          materialSpec: body.materialSpec || null,
          photos: body.photos || [],
          progressPercent: Number(body.progressPercent || 0),
          materialVerified,
          recordedAt: new Date(body.recordedAt || Date.now()),
          recorderId: u.sub,
        }),
      );
      // 联动整改项状态
      if (body.itemId) {
        const item = await m.findOne(RectificationItem, { where: { id: body.itemId } });
        if (item) {
          item.status = body.itemStatus || (materialVerified ? ItemStatus.IN_PROGRESS : ItemStatus.PENDING);
          await m.save(item);
        }
      }
      if (!materialVerified) {
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.MATERIAL_SWAP,
            description: swapDetail,
            status: IssueStatus.OPEN,
            blocksWorkflow: true,
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
      }
      house.status = HouseStatus.RECTIFYING;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: materialVerified ? 'CONSTRUCTION' : 'MATERIAL',
          title: materialVerified ? `施工进度上报：${body.stage}（${body.progressPercent || 0}%）` : `材料核验异常：${body.stage}`,
          detail: materialVerified ? body.content : `${swapDetail}；${body.content}`,
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return log;
    });
  }

  async setItemStatus(u: CurrentUser, itemId: string, status: ItemStatus) {
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException();
    item.status = status;
    await this.items.save(item);
    const plan = await this.plans.findOne({ where: { id: item.planId } });
    await this.logActivity(plan.houseId, 'CONSTRUCTION', `整改项「${itemTypeLabel(item.type)}」标记为${itemStatusLabel(status)}`, item.description, u);
    return item;
  }

  // ---------- 验收（逐条确认）----------
  async createAcceptance(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('没有整改方案');
    if (house.status === HouseStatus.CLOSED) throw new BadRequestException('房屋已销号');
    await this.assertNoBlocking(house.id, '组织验收');
    // 全员清退闸口：登记人数与现场核对不符（有人未离开/偷返）不得验收
    if (plan.evacuationRequired) await this.assertFullEvacuation(house, '组织验收');

    const itemResults: any[] = body.itemResults || [];
    if (plan.items.filter((i) => i.required).length !== itemResults.length) {
      throw new BadRequestException('必须对方案中的每一个必改项逐条给出验收结论');
    }
    // 必改项须先完成施工
    for (const it of plan.items.filter((i) => i.required)) {
      if (it.status !== ItemStatus.DONE) {
        throw new BadRequestException(`整改项「${itemTypeLabel(it.type)}」施工状态为${itemStatusLabel(it.status)}，未完成不能验收`);
      }
      const r = itemResults.find((x) => x.itemId === it.id);
      if (!r) throw new BadRequestException(`缺少整改项「${itemTypeLabel(it.type)}」的验收结论`);
    }
    const anyFail = itemResults.some((r) => r.result === AcceptanceResult.FAIL);
    const overall = anyFail ? AcceptanceResult.FAIL : AcceptanceResult.PASS;

    return this.dataSource.transaction(async (m) => {
      const acc = await m.save(
        m.create(Acceptance, {
          houseId: house.id,
          planId: plan.id,
          inspectorId: u.sub,
          inspectorName: u.name,
          acceptedAt: new Date(),
          overall,
          comment: body.comment || '',
        }),
      );
      for (const r of itemResults) {
        await m.save(
          m.create(AcceptanceItemResult, {
            acceptanceId: acc.id,
            itemId: r.itemId,
            itemType: r.itemType,
            result: r.result,
            note: r.note || '',
            photos: r.photos || [],
          }),
        );
        if (r.result === AcceptanceResult.FAIL) {
          const item = await m.findOne(RectificationItem, { where: { id: r.itemId } });
          if (item) {
            item.status = ItemStatus.FAILED;
            await m.save(item);
          }
        }
      }

      if (overall === AcceptanceResult.FAIL) {
        house.status = HouseStatus.ACCEPTANCE_FAILED;
        await m.save(house);
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.ACCEPTANCE_FAIL,
            description: `验收不通过：${itemResults.filter((r) => r.result === 'FAIL').map((r) => itemTypeLabel(r.itemType)).join('、')}；${body.comment || ''}`,
            status: IssueStatus.OPEN,
            blocksWorkflow: true,
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id,
            kind: 'ACCEPTANCE',
            title: '验收不通过，退回重新整改',
            detail: body.comment || '',
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      } else {
        house.status = HouseStatus.PENDING_ACCEPTANCE;
        await m.save(house);
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id,
            kind: 'ACCEPTANCE',
            title: '验收通过（逐项确认合格），提请县级销号',
            detail: body.comment || '',
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      }
      return m.findOne(Acceptance, { where: { id: acc.id }, relations: ['itemResults'] });
    });
  }

  // ---------- 销号 ----------
  async closeHouse(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const acc = await this.acceptances.findOne({ where: { houseId: house.id }, order: { acceptedAt: 'DESC' }, relations: ['itemResults'] });
    if (!acc || acc.overall !== AcceptanceResult.PASS) throw new BadRequestException('最新验收未通过，不能销号');
    if (house.status !== HouseStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException('仅“验收通过待销号”状态的房屋可销号');
    }
    if (!body.confirmedAllItems) throw new BadRequestException('须逐项确认整改方案全部完成');
    if (!body.confirmedStopUseLifted) throw new BadRequestException('须确认房屋安全恢复、停用/警示措施按方案处理');
    await this.assertNoBlocking(house.id, '销号');
    // 人员清退闸口：登记6人只确认5人离开等情形不得销号
    const planForClose = await this.latestPlan(house.id);
    if (planForClose?.evacuationRequired) await this.assertFullEvacuation(house, '销号');

    return this.dataSource.transaction(async (m) => {
      await m.save(
        m.create(CloseRecord, {
          houseId: house.id,
          acceptanceId: acc.id,
          closedAt: new Date(),
          closedById: u.sub,
          confirmedAllItems: true,
          confirmedStopUseLifted: true,
          revoked: false,
          remark: body.remark || '',
        }),
      );
      house.status = HouseStatus.CLOSED;
      house.stopUseConfirmed = false;
      await m.save(house);
      // 准许转移人员返回：旧的批量转移记录与逐人清册同步
      await m.update(EvacuationRecord, { houseId: house.id, allowReturn: false }, { allowReturn: true, returnedAt: new Date() });
      await m.update(
        EvacuationPerson,
        { houseId: house.id, moveStatus: PersonMoveStatus.RESETTLED },
        { safeReturnedAt: new Date() },
      );
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'CLOSE',
          title: '县级销号：整改按方案完成，房屋恢复安全使用',
          detail: body.remark || '经营房屋须在另行准许后方可复营业',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { ok: true };
    });
  }

  // ---------- 复查 ----------
  async createRecheck(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    if (house.status !== HouseStatus.CLOSED) throw new BadRequestException('仅已销号房屋需要销号后复查；整改期间请用“现场核查（同事件续办）”');
    const result: AcceptanceResult = body.result;
    return this.dataSource.transaction(async (m) => {
      await m.save(
        m.create(RecheckRecord, {
          houseId: house.id,
          phase: 'POST_CLOSE',
          result,
          reboundNotes: body.reboundNotes || '',
          photos: body.photos || [],
          wallCrack: body.wallCrack ?? null,
          roofLeak: body.roofLeak ?? null,
          foundationSettlement: body.foundationSettlement ?? null,
          checkedAt: new Date(),
          inspectorId: u.sub,
          inspectorName: u.name,
        }),
      );
      if (result === AcceptanceResult.FAIL) {
        house.status = HouseStatus.REBOUND;
        // 回写最新隐患
        if (body.wallCrack != null) house.wallCrack = Number(body.wallCrack);
        if (body.roofLeak != null) house.roofLeak = Number(body.roofLeak);
        if (body.foundationSettlement != null) house.foundationSettlement = Number(body.foundationSettlement);
        // 旧销号结论失效；复营业准许一并收回，清册进入新一轮现场核对
        house.fullEvacuationConfirmed = false;
        house.resumeBusinessApproved = false;
        await m.save(house);
        const close = await m.findOne(CloseRecord, { where: { houseId: house.id }, order: { closedAt: 'DESC' } });
        if (close && !close.revoked) {
          close.revoked = true;
          close.revokedAt = new Date();
          close.revokedById = u.sub;
          close.revokeReason = `销号后复查反弹：${body.reboundNotes || '隐患重新出现'}`;
          await m.save(close);
        }
        await m.update(EvacuationRecord, { houseId: house.id, allowReturn: true }, { allowReturn: false });
        await m.update(
          EvacuationPerson,
          { houseId: house.id },
          { moveStatus: PersonMoveStatus.REGISTERED, continueBusiness: false, safeReturnedAt: null, verifiedAt: null },
        );
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.REBOUND,
            description: `销号后复查发现问题反弹，原销号已撤销：${body.reboundNotes || '隐患重新出现'}`,
            status: IssueStatus.OPEN,
            blocksWorkflow: true,
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
      }
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'RECHECK',
          title: result === AcceptanceResult.PASS ? '复查通过，保持销号' : '复查发现问题反弹，原事件重新纳入治理（旧销号撤销）',
          detail: body.reboundNotes || '',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { ok: true };
    });
  }

  // ---------- 房屋档案聚合 ----------
  async listHouses(query: any, u: CurrentUser) {
    const qb = this.houses.createQueryBuilder('h');
    const township = query.township || (u.role === 'TOWNSHIP_REVIEWER' || u.role === 'GRID_WORKER' ? u.township : undefined);
    if (township) qb.andWhere('h.township = :t', { t: township });
    if (query.riskLevel) qb.andWhere('h.riskLevel = :r', { r: query.riskLevel });
    if (query.status) qb.andWhere('h.status = :s', { s: query.status });
    if (query.q) qb.andWhere('(h.ownerName ILIKE :q OR h.address ILIKE :q OR h.code ILIKE :q OR h.village ILIKE :q)', { q: `%${query.q}%` });
    qb.orderBy('h.createdAt', 'DESC');
    const [data, total] = await qb.take(Math.min(Number(query.limit) || 100, 500)).skip(Number(query.offset) || 0).getManyAndCount();
    return { total, data };
  }

  async houseArchive(id: string) {
    const house = await this.getHouseOrFail(id);
    const [
      inspections, plans, notices, evacuations, stakeholders, consultations, issues,
      family, cplan, subsidy, logs, acceptances, close, rechecks, activities,
      evacPersons, shelters, allowances,
    ] = await Promise.all([
      this.inspections.find({ where: { houseId: id }, order: { inspectedAt: 'DESC' } }),
      this.plans.find({ where: { houseId: id }, order: { reviewedAt: 'DESC' }, relations: ['items'] }),
      this.notices.find({ where: { houseId: id }, order: { notifiedAt: 'DESC' } }),
      this.evacuations.find({ where: { houseId: id }, order: { settledAt: 'DESC' } }),
      this.stakeholders.find({ where: { houseId: id } }),
      this.consultations.find({ where: { houseId: id }, order: { heldAt: 'DESC' } }),
      this.issues.find({ where: { houseId: id }, order: { raisedAt: 'DESC' } }),
      this.families.findOne({ where: { houseId: id } }),
      this.cplans.findOne({ where: { houseId: id }, relations: ['budgetItems'] }),
      this.subsidies.findOne({ where: { houseId: id } }),
      this.logs.find({ where: { houseId: id }, order: { recordedAt: 'DESC' } }),
      this.acceptances.find({ where: { houseId: id }, order: { acceptedAt: 'DESC' }, relations: ['itemResults'] }),
      this.closes.findOne({ where: { houseId: id }, order: { closedAt: 'DESC' } }),
      this.rechecks.find({ where: { houseId: id }, order: { checkedAt: 'DESC' } }),
      this.activities.find({ where: { houseId: id }, order: { createdAt: 'DESC' }, take: 200 }),
      this.evacPersons.find({ where: { houseId: id }, order: { registeredAt: 'ASC' } }),
      this.shelters.find(),
      this.allowances.find({ where: { houseId: id }, order: { createdAt: 'DESC' } }),
    ]);
    const blockingIssues = issues.filter((i) => i.blocksWorkflow && i.status !== IssueStatus.RESOLVED);
    const roster = await this.rosterSummary(id);
    return {
      house, inspections, plans, notices, evacuations, stakeholders, consultations, issues, blockingIssues,
      family, constructionPlan: cplan, subsidy, constructionLogs: logs, acceptances, close, rechecks, activities,
      evacPersons, shelters, allowances, roster,
      closeValid: !!(close && !close.revoked),
    };
  }

  // ---------- 县级驾驶舱 ----------
  async dashboard(query: any, u?: CurrentUser) {
    const forcedTownship = u && (u.role === 'TOWNSHIP_REVIEWER' || u.role === 'GRID_WORKER') ? u.township : null;
    const township = query.township || forcedTownship || null;
    const filter = township ? { township } : {};
    const houses = await this.houses.find({ where: filter });
    const byRisk: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byTownship: Record<string, { total: number; highRisk: number; closed: number; rebound: number }> = {};
    let closed = 0, rebound = 0, highRisk = 0, highRiskStopped = 0;
    for (const h of houses) {
      byRisk[h.riskLevel] = (byRisk[h.riskLevel] || 0) + 1;
      byStatus[h.status] = (byStatus[h.status] || 0) + 1;
      const t = byTownship[h.township] || { total: 0, highRisk: 0, closed: 0, rebound: 0 };
      t.total++;
      const isHigh = h.riskLevel === RiskLevel.SUSPEND || h.riskLevel === RiskLevel.EVACUATE;
      if (isHigh) {
        highRisk++;
        t.highRisk++;
        if ([HouseStatus.STOPPED, HouseStatus.EVACUATED, HouseStatus.RECTIFYING, HouseStatus.PENDING_ACCEPTANCE, HouseStatus.CLOSED, HouseStatus.ACCEPTANCE_FAILED].includes(h.status)) {
          highRiskStopped++;
        }
      }
      if (h.status === HouseStatus.CLOSED) {
        closed++;
        t.closed++;
      }
      if (h.status === HouseStatus.REBOUND) {
        rebound++;
        t.rebound++;
      }
      byTownship[h.township] = t;
    }

    // 高风险但未真正停用的房屋（县级最关注）
    const qbStopped = this.houses
      .createQueryBuilder('h')
      .where('h.riskLevel IN (:...rs)', { rs: [RiskLevel.SUSPEND, RiskLevel.EVACUATE] })
      .andWhere('h.status NOT IN (:...ss)', {
        ss: [HouseStatus.STOPPED, HouseStatus.EVACUATED, HouseStatus.RECTIFYING, HouseStatus.PENDING_ACCEPTANCE, HouseStatus.CLOSED, HouseStatus.ACCEPTANCE_FAILED],
      });
    if (township) qbStopped.andWhere('h.township = :t', { t: township });
    const notStopped = await qbStopped.getMany();

    // 异常分类
    const issueQb = this.issues.createQueryBuilder('i').leftJoin(House, 'h', 'h.id::text = i."houseId"::text');
    if (township) issueQb.andWhere('h.township = :t', { t: township });
    const allIssues = await issueQb.getMany();
    const issuesByType: Record<string, { open: number; resolved: number }> = {};
    for (const i of allIssues) {
      const k = i.type;
      issuesByType[k] = issuesByType[k] || { open: 0, resolved: 0 };
      if (i.status === IssueStatus.RESOLVED) issuesByType[k].resolved++;
      else issuesByType[k].open++;
    }

    // 补助
    const subQb = this.subsidies.createQueryBuilder('s').leftJoin(House, 'h', 'h.id::text = s."houseId"::text');
    if (township) subQb.andWhere('h.township = :t', { t: township });
    const subsidies = await subQb.getMany();
    const subsidySummary = { draft: 0, submitted: 0, approved: 0, rejected: 0, paid: 0, paidAmount: 0 };
    for (const s of subsidies) {
      if (s.status === SubsidyStatus.DRAFT) subsidySummary.draft++;
      if (s.status === SubsidyStatus.SUBMITTED) subsidySummary.submitted++;
      if (s.status === SubsidyStatus.APPROVED) subsidySummary.approved++;
      if (s.status === SubsidyStatus.REJECTED) subsidySummary.rejected++;
      if (s.status === SubsidyStatus.PAID) {
        subsidySummary.paid++;
        subsidySummary.paidAmount += Number(s.amount);
      }
    }

    // 整改项完成情况
    const planQb = this.items.createQueryBuilder('it').leftJoin(ReviewPlan, 'p', 'p.id::text = it."planId"::text').leftJoin(House, 'h', 'h.id::text = p."houseId"::text');
    if (township) planQb.andWhere('h.township = :t', { t: township });
    const allItems = await planQb.getMany();
    const itemByType: Record<string, { total: number; done: number; failed: number }> = {};
    for (const it of allItems) {
      const k = itemByType[it.type] || { total: 0, done: 0, failed: 0 };
      k.total++;
      if (it.status === ItemStatus.DONE) k.done++;
      if (it.status === ItemStatus.FAILED) k.failed++;
      itemByType[it.type] = k;
    }

    // 人员转移清册核对（全县/本乡镇）：逐人核对，登记人数≠离开人数不得清退
    const houseIds = houses.map((h) => h.id);
    const evacHouses = houses.filter((h) => h.riskLevel === RiskLevel.EVACUATE);
    const persons = houseIds.length
      ? await this.evacPersons.find({ where: { houseId: In(houseIds) } })
      : [];
    const byHouse = new Map<string, EvacuationPerson[]>();
    for (const p of persons) {
      const arr = byHouse.get(p.houseId) || [];
      arr.push(p);
      byHouse.set(p.houseId, arr);
    }
    const evacuation = {
      housesRequiring: evacHouses.length,
      housesFullyCleared: 0,
      housesPartial: 0,
      housesReturned: 0,
      personsRegistered: persons.length,
      personsResettled: 0,
      personsStillOnSite: 0,
      personsReturned: 0,
      continuingBusiness: 0,
    };
    for (const h of evacHouses) {
      const ps = byHouse.get(h.id) || [];
      if (!ps.length) continue;
      const resettled = ps.filter((p) => p.moveStatus === 'RESETTLED').length;
      const returned = ps.filter((p) => p.moveStatus === 'RETURNED').length;
      const onSite = ps.filter((p) => p.moveStatus === 'STILL_ON_SITE').length;
      evacuation.personsResettled += resettled;
      evacuation.personsStillOnSite += onSite;
      evacuation.personsReturned += returned;
      evacuation.continuingBusiness += ps.filter((p) => p.continueBusiness).length;
      if (returned > 0) evacuation.housesReturned++;
      else if (resettled >= ps.length) evacuation.housesFullyCleared++;
      else evacuation.housesPartial++;
    }

    // 安置补助 / 经营损失拨付监督
    const allAllowances = houseIds.length ? await this.allowances.find({ where: { houseId: In(houseIds) } }) : [];
    const allowanceSummary = { applied: 0, approved: 0, rejected: 0, paid: 0, paidAmount: 0, resettlementPaid: 0, businessPaid: 0 };
    for (const al of allAllowances) {
      if (al.status === 'APPLIED') allowanceSummary.applied++;
      if (al.status === 'APPROVED') allowanceSummary.approved++;
      if (al.status === 'REJECTED') allowanceSummary.rejected++;
      if (al.status === 'PAID') {
        allowanceSummary.paid++;
        const v = Number(al.approvedAmount || al.amount);
        allowanceSummary.paidAmount += v;
        if (al.type === 'RESETTLEMENT') allowanceSummary.resettlementPaid += v;
        else allowanceSummary.businessPaid += v;
      }
    }

    return {
      totalHouses: houses.length,
      byRisk,
      byStatus,
      byTownship,
      closed,
      rebound,
      highRisk,
      highRiskStopped,
      highRiskStopRate: highRisk ? Number((highRiskStopped / highRisk).toFixed(2)) : 1,
      notStoppedHouses: notStopped.map((h) => ({ id: h.id, code: h.code, township: h.township, village: h.village, ownerName: h.ownerName, riskLevel: h.riskLevel, status: h.status })),
      issuesByType,
      subsidySummary,
      allowanceSummary,
      evacuation,
      itemByType,
      closureRate: houses.length ? Number((closed / houses.length).toFixed(2)) : 0,
    };
  }
}

// ---------- 标签 ----------
export function riskLabel(l: RiskLevel) {
  return { NORMAL: '一般关注', RECTIFY: '限期整改', SUSPEND: '暂停使用', EVACUATE: '紧急转移' }[l] || l;
}
export function houseStatusLabel(s: HouseStatus) {
  return {
    PENDING_REVIEW: '待复核', IN_PLAN: '已出方案', NOTIFIED: '已告知', STOPPED: '已停用',
    EVACUATING: '转移中（未清退）', EVACUATED: '已清退转移', RECTIFYING: '整改中', PENDING_ACCEPTANCE: '待销号', ACCEPTANCE_FAILED: '验收不通过',
    CLOSED: '已销号', REBOUND: '问题反弹/续办', REFUSED: '拒绝整改',
  }[s] || s;
}
export function itemTypeLabel(t: string) {
  return {
    REMOVE_ILLEGAL_FLOOR: '拆除违建加层', REINFORCE_WALL: '加固承重墙', REPAIR_ROOF: '修复屋面',
    EVICT_TENANTS: '清退经营租户', SET_WARNING: '设置警示', TEMP_RESETTLEMENT: '安排临时安置',
  }[t] || t;
}
export function itemStatusLabel(s: string) {
  return { PENDING: '待施工', IN_PROGRESS: '施工中', DONE: '已完成', FAILED: '不合格' }[s] || s;
}
export function issueTypeLabel(t: string) {
  return {
    FARMER_REFUSE: '农户拒绝整改', MATERIAL_SWAP: '偷换材料', SUBSIDY_DISPUTE: '补助资格争议',
    RAIN_SEASON: '雨季风险加重', TENANT_REFUSE: '租户不愿搬离', ACCEPTANCE_FAIL: '验收不通过', REBOUND: '复查发现问题反弹',
    PERSON_RETURN: '整改期间擅自返回/偷营业', EVACUATION_INCOMPLETE: '人员未全部清退',
  }[t] || t;
}
export function personRoleLabel(r: string) {
  return { OWNER: '户主/家庭成员', RESIDENT: '常住人员', TENANT: '租户', OPERATOR: '经营者', EMPLOYEE: '经营从业人员' }[r] || r;
}
export function personMoveStatusLabel(s: string) {
  return { REGISTERED: '已登记待核对', RESETTLED: '已离开并安置', STILL_ON_SITE: '仍在现场', RETURNED: '擅自返回' }[s] || s;
}
export function difficultyLabel(d: string) {
  return {
    NONE: '无', LOW_INCOME: '低保户', FIVE_GUARANTEE: '五保户', DISABLED: '残疾人家庭',
    MONITORING: '防止返贫监测户', VETERAN: '优抚对象',
  }[d] || d;
}
