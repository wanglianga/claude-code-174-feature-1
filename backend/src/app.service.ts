import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  Acceptance,
  AcceptanceItemResult,
  AcceptanceResult,
  AidStatus,
  BudgetItem,
  BusinessLoss,
  BusinessResumption,
  CloseRecord,
  ConstructionLog,
  ConstructionPlan,
  ConstructionTeam,
  Consultation,
  DifficultyType,
  EvacuationPerson,
  EvacuationRecord,
  FamilyProfile,
  House,
  HouseActivity,
  HouseStatus,
  Inspection,
  IssueRecord,
  IssueStatus,
  IssueType,
  ItemStatus,
  LossStatus,
  NoticeRecord,
  PersonCategory,
  PersonEvacStatus,
  RectificationItem,
  RecheckRecord,
  ResettlementAid,
  ResumptionStatus,
  ReviewPlan,
  RiskLevel,
  Stakeholder,
  SubsidyApplication,
  SubsidyStatus,
  User,
} from './entities';
import { evaluateRisk } from './risk.rules';

const SUBSIDY_RATE = 0.7; // 补助不超过核定预算的70%
const SUBSIDY_CAP = 50000; // 每户最高补助5万元
const AID_RATE_PER_DAY = 50; // 过渡期安置补助参考标准：元/人天
const AID_CAP = 20000; // 安置补助每户上限

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
    @InjectRepository(EvacuationPerson) private persons: Repository<EvacuationPerson>,
    @InjectRepository(ResettlementAid) private aids: Repository<ResettlementAid>,
    @InjectRepository(BusinessLoss) private losses: Repository<BusinessLoss>,
    @InjectRepository(BusinessResumption) private resumptions: Repository<BusinessResumption>,
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

  // ---------- 人员转移清退口径（逐人花名册汇总）----------
  async evacuationRollup(houseId: string) {
    const persons = await this.persons.find({ where: { houseId } });
    const count = (s: PersonEvacStatus) => persons.filter((p) => p.evacStatus === s).length;
    const relocated = count(PersonEvacStatus.RELOCATED);
    const staying = count(PersonEvacStatus.STAYING);
    const sneakBack = count(PersonEvacStatus.SNEAK_BACK);
    const returned = count(PersonEvacStatus.RETURNED);
    const registered = persons.length;
    const stillOperating = persons.some((p) => p.stillOperating);
    // 全员清退：花名册中每一个人都被现场确认离开（RETURNED 是销号准许后的安全返回，也算已落实过清退）
    const cleared =
      registered > 0 &&
      persons.every((p) => [PersonEvacStatus.RELOCATED, PersonEvacStatus.RETURNED].includes(p.evacStatus));
    const unresolved = registered - relocated - returned; // 仍在房屋内/偷返人数
    return { persons, registered, relocated, staying, sneakBack, returned, stillOperating, cleared, unresolved };
  }

  /** 将花名册核对结果回写房屋主表（“已清退”只能由全员核对得出） */
  async syncHouseEvictionState(m: any, house: House, rollup: { registered: number; cleared: boolean; stillOperating: boolean }) {
    house.registeredCount = rollup.registered;
    house.evictionCleared = rollup.cleared;
    house.businessClosed = house.isBusiness ? rollup.cleared && !rollup.stillOperating : !rollup.stillOperating;
    await m.save(house);
  }

  /** 方案要求转移的房屋，未全员清退时统一拦截口径 */
  async assertEvacuationCleared(house: House, action: string) {
    const plan = await this.latestPlan(house.id);
    if (!plan?.evacuationRequired) return;
    const r = await this.evacuationRollup(house.id);
    if (r.registered === 0) {
      throw new BadRequestException(`尚未建立人员转移花名册并逐人现场核对，不能${action}`);
    }
    if (!r.cleared) {
      throw new BadRequestException(
        `花名册登记 ${r.registered} 人、现场仅确认 ${r.relocated} 人离开（${r.staying} 人仍在、${r.sneakBack} 人偷返），未全员清退，不能${action}`,
      );
    }
    if (r.stillOperating) {
      throw new BadRequestException(`现场核对仍有人继续经营，经营未停止，不能${action}`);
    }
  }

  async latestValidClose(houseId: string) {
    const recs = await this.closes.find({ where: { houseId }, order: { closedAt: 'DESC' } });
    return recs.find((c) => !c.invalidated) || null;
  }

  /** 作废当前有效销号：复查/再巡查发现偷返或反弹时，旧销号结果不得继续有效 */
  async invalidateActiveClose(m: any, houseId: string, reason: string, u?: CurrentUser) {
    const activeCloses = await m.find(CloseRecord, { where: { houseId, invalidated: false } });
    for (const c of activeCloses) {
      c.invalidated = true;
      c.invalidatedAt = new Date();
      c.invalidateReason = reason;
      await m.save(c);
    }
    // 撤销“准许返回”，转移人员重新处于管控状态
    await m.update(EvacuationRecord, { houseId, allowReturn: true }, { allowReturn: false });
    // 随销号一并失效复营业核准：重新治理并再次销号后须重新申请
    await m.update(
      BusinessResumption,
      { houseId, status: ResumptionStatus.APPROVED },
      { status: ResumptionStatus.APPLIED, reviewComment: '原销号作废，本次复营业核准一并失效，须重新申请', resumeFrom: null },
    );
    if (activeCloses.length) {
      await m.save(
        m.create(HouseActivity, {
          houseId,
          kind: 'CLOSE',
          title: `原销号结果已作废（${activeCloses.length} 次）`,
          detail: reason,
          operatorId: u?.sub,
          operatorName: u?.name,
        }),
      );
    }
    return activeCloses.length;
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
      const hadRisk = level !== RiskLevel.NORMAL;
      const prevStatus = house.status;
      if ([HouseStatus.CLOSED, HouseStatus.REBOUND].includes(house.status) && hadRisk) {
        house.status = HouseStatus.PENDING_REVIEW;
      } else if (!house.status || house.status === HouseStatus.CLOSED) {
        house.status = HouseStatus.PENDING_REVIEW;
      }
      house = await m.save(house);
      // 已销号房屋再次巡查发现风险：旧销号不得继续有效（同档案继续治理，不新建记录）
      if (hadRisk && prevStatus === HouseStatus.CLOSED) {
        await this.invalidateActiveClose(m, house.id, '再次巡查发现新风险，原销号结果停止有效，按原档案重新治理', u);
      }

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
      house.stopUseConfirmed = true;
      // 是否“已转移/已清退”以花名册逐人核对为准，批次登记人数不代表全员离开
      const rollup = await this.evacuationRollup(house.id);
      await this.syncHouseEvictionState(m, house, rollup);
      house.status = rollup.cleared ? HouseStatus.EVACUATED : plan.evacuationRequired ? HouseStatus.STOPPED : HouseStatus.STOPPED;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'EVACUATE',
          title: `登记转移安置批次 ${rec.residents} 人 → ${rec.destination}`,
          detail: rollup.registered
            ? `花名册口径：登记 ${rollup.registered} 人，已确认离开 ${rollup.relocated} 人，未离开/偷返 ${rollup.unresolved} 人；验收通过并销号前不得擅自返回`
            : '尚未建立逐人花名册；“已清退”须网格员对花名册逐人现场核对',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { record: rec, rollup };
    });
  }

  // ---------- 人员转移花名册（逐人现场核对）----------
  /** 初始化/补录花名册：可按档案居住人数生成占位人员，或直接传入名单 */
  async initPersonRoster(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    const existed = await this.persons.find({ where: { houseId } });
    const rows: any[] = body.persons || [];
    const added = rows.filter((p) => p.name).length;
    const placeholderCount = rows.length ? 0 : Math.max(0, Number(body.count || house.residents || 0) - existed.length);
    await this.dataSource.transaction(async (m) => {
      for (const p of rows) {
        if (!p.name) continue;
        await m.save(
          m.create(EvacuationPerson, {
            houseId,
            name: p.name,
            category: p.category || PersonCategory.RESIDENT,
            phone: p.phone || null,
            evacStatus: PersonEvacStatus.REGISTERED,
            stillOperating: !!p.stillOperating,
            remark: p.remark || null,
          }),
        );
      }
      // 无显式名单时，按档案居住人数生成待核对占位行
      for (let i = 0; i < placeholderCount; i++) {
        await m.save(
          m.create(EvacuationPerson, {
            houseId,
            name: `待核对人员${existed.length + i + 1}`,
            category: PersonCategory.RESIDENT,
            evacStatus: PersonEvacStatus.REGISTERED,
          }),
        );
      }
      await m.save(
        m.create(HouseActivity, {
          houseId,
          kind: 'EVACUATE',
          title: `建立/补充转移人员花名册（新增 ${added + placeholderCount} 人待现场核对）`,
          detail: '清退口径以网格员逐人现场核对为准',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
    });
    // 事务提交后再汇总（独立连接才能读到已提交数据），回写房屋清退状态
    const rollup = await this.evacuationRollup(houseId);
    await this.dataSource.transaction(async (m) => {
      const h = await m.findOne(House, { where: { id: houseId } });
      await this.syncHouseEvictionState(m, h, rollup);
    });
    return rollup;
  }

  /** 网格员现场逐人核对：谁离开、去了哪个安置点、从哪天安置、是否仍在经营、留照片 */
  async verifyPerson(u: CurrentUser, personId: string, body: any) {
    const p = await this.persons.findOne({ where: { id: personId } });
    if (!p) throw new NotFoundException('花名册人员不存在');
    const status: PersonEvacStatus = body.evacStatus;
    if (!Object.values(PersonEvacStatus).includes(status)) throw new BadRequestException('请选择现场核对结论');

    await this.dataSource.transaction(async (m) => {
      p.evacStatus = status;
      if (status === PersonEvacStatus.RELOCATED) {
        if (!body.destination) throw new BadRequestException('确认离开必须填写安置去向/安置点');
        if (!body.settledFrom) throw new BadRequestException('请填写开始安置日期');
        p.destination = body.destination;
        p.settledFrom = body.settledFrom;
      }
      if (status === PersonEvacStatus.STAYING && !body.remark) {
        throw new BadRequestException('确认仍在房屋内的人员须填写现场情况说明');
      }
      p.stillOperating = !!body.stillOperating;
      if (body.name) p.name = body.name;
      if (body.category) p.category = body.category;
      if (body.phone !== undefined) p.phone = body.phone;
      if (body.photos !== undefined) p.photos = body.photos;
      if (body.remark !== undefined) p.remark = body.remark;
      p.verifiedAt = new Date();
      p.verifiedById = u.sub;
      p.verifiedByName = u.name;
      await m.save(p);
    });

    // 事务提交后重新汇总（独立连接读已提交数据），再回写房屋清退/状态
    const rollup = await this.evacuationRollup(p.houseId);
    await this.dataSource.transaction(async (m) => {
      const house = await m.findOne(House, { where: { id: p.houseId } });
      await this.syncHouseEvictionState(m, house, rollup);
      // 花名册全员确认离开且方案要求转移，才推进为“已转移”；一旦进入整改/验收等后续环节不倒退
      const plan = await this.latestPlan(p.houseId);
      if (
        rollup.cleared &&
        plan?.evacuationRequired &&
        [HouseStatus.STOPPED, HouseStatus.NOTIFIED, HouseStatus.IN_PLAN].includes(house.status)
      ) {
        house.status = HouseStatus.EVACUATED;
        await m.save(house);
      }

      const titleMap: Record<string, string> = {
        RELOCATED: `现场核对：${p.name} 已离开并安置到 ${p.destination}`,
        STAYING: `现场核对：${p.name} 仍在房屋内（未清退）`,
        SNEAK_BACK: `现场核对：${p.name} 整改期间擅自返回`,
        RETURNED: `现场核对：${p.name} 准许后安全返回`,
        REGISTERED: `现场核对：${p.name} 恢复为待核对`,
      };
      await m.save(
        m.create(HouseActivity, {
          houseId: p.houseId,
          kind: 'EVACUATE',
          title: titleMap[status] || `现场核对：${p.name}`,
          detail: [p.settledFrom ? `安置起始 ${p.settledFrom}` : '', p.stillOperating ? '仍在继续经营' : '', p.remark || '']
            .filter(Boolean)
            .join('；'),
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
    });
    return { person: p, rollup };
  }

  async deletePerson(u: CurrentUser, personId: string) {
    const p = await this.persons.findOne({ where: { id: personId } });
    if (!p) throw new NotFoundException();
    const houseId = p.houseId;
    await this.persons.remove(p);
    const house = await this.houses.findOne({ where: { id: houseId } });
    if (house) {
      const rollup = await this.evacuationRollup(houseId);
      await this.dataSource.transaction(async (m) => this.syncHouseEvictionState(m, house, rollup));
    }
    return { ok: true };
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
    // 停用/转移制约：紧急转移房屋以花名册逐人核对、全员清退为准（6人登记只确认5人离开不得开工）
    if (plan.evacuationRequired) {
      const evac = await this.evacuations.findOne({ where: { houseId: house.id }, order: { settledAt: 'DESC' } });
      if (!evac) throw new BadRequestException('紧急转移尚未登记安置，不能开工');
      await this.assertEvacuationCleared(house, '开工');
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
    const evacRollup = plan?.evacuationRequired ? await this.evacuationRollup(house.id) : null;
    const stopGuard = !plan
      ? { ok: false, message: '乡镇尚未下达整改方案' }
      : plan.evacuationRequired
        ? evacRollup!.cleared
          ? { ok: true, message: `花名册 ${evacRollup!.registered} 人已全部确认离开并安置` }
          : {
              ok: false,
              message: evacRollup!.registered === 0
                ? '应紧急转移：尚未建立逐人花名册并现场核对'
                : `应全员清退：登记 ${evacRollup!.registered} 人仅确认 ${evacRollup!.relocated} 人离开（仍在 ${evacRollup!.staying}、偷返 ${evacRollup!.sneakBack}）`,
            }
        : plan.stopUseRequired
          ? house.stopUseConfirmed
            ? { ok: true, message: '已确认停用' }
            : { ok: false, message: '应停用但未确认停用' }
          : { ok: true, message: '方案未要求停用' };

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
        ok: stopGuard.ok,
        message: stopGuard.message,
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

  /** 发放：必须在验收通过（销号且销号仍有效）后，且申请已批准 */
  async paySubsidy(u: CurrentUser, id: string) {
    const app = await this.subsidies.findOne({ where: { id } });
    if (!app) throw new NotFoundException();
    if (app.status !== SubsidyStatus.APPROVED) throw new BadRequestException('仅已批准的申请可发放');
    const close = await this.latestValidClose(app.houseId);
    if (!close) throw new BadRequestException('房屋未完成验收销号或原销号已作废，补助不得提前发放（防止“带病拨款”）');
    app.status = SubsidyStatus.PAID;
    app.paidAt = new Date();
    await this.subsidies.save(app);
    await this.logActivity(app.houseId, 'SUBSIDY', `补助资金已发放 ¥${app.amount}`, '验收销号后发放，符合条件家庭', u);
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
    await this.assertEvacuationCleared(house, '组织验收（人员未全员清退不得验收销号）');

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
    // 清退与阻断口径优先于状态检查：6人登记5人离开时，明确报“未清退”而非泛化状态错误
    await this.assertEvacuationCleared(house, '销号（花名册未全员清退不得销号）');
    await this.assertNoBlocking(house.id, '销号');
    const acc = await this.acceptances.findOne({ where: { houseId: house.id }, order: { acceptedAt: 'DESC' }, relations: ['itemResults'] });
    if (!acc || acc.overall !== AcceptanceResult.PASS) throw new BadRequestException('最新验收未通过，不能销号');
    if (house.status !== HouseStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException('仅“验收通过待销号”状态的房屋可销号');
    }
    if (!body.confirmedAllItems) throw new BadRequestException('须逐项确认整改方案全部完成');
    if (!body.confirmedStopUseLifted) throw new BadRequestException('须确认房屋安全恢复、停用/警示措施按方案处理');

    return this.dataSource.transaction(async (m) => {
      await m.save(
        m.create(CloseRecord, {
          houseId: house.id,
          acceptanceId: acc.id,
          closedAt: new Date(),
          closedById: u.sub,
          confirmedAllItems: true,
          confirmedStopUseLifted: true,
          remark: body.remark || '',
        }),
      );
      house.status = HouseStatus.CLOSED;
      house.stopUseConfirmed = false;
      await m.save(house);
      // 准许转移人员返回；花名册中已安置人员登记为安全返回
      await m.update(EvacuationRecord, { houseId: house.id, allowReturn: false }, { allowReturn: true, returnedAt: new Date() });
      await m.update(
        EvacuationPerson,
        { houseId: house.id, evacStatus: PersonEvacStatus.RELOCATED },
        { evacStatus: PersonEvacStatus.RETURNED, returnedAt: new Date() },
      );
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'CLOSE',
          title: '县级销号：整改按方案完成，房屋恢复安全使用',
          detail: body.remark || '',
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
    // 已销号房屋的常规反弹复查，或整改期间对偷返/现场人员的抽查（接着原事件处理）
    const activeClose = await this.latestValidClose(body.houseId);
    const isSneak = !!body.sneakReturn;
    if (!isSneak && !activeClose) throw new BadRequestException('当前没有有效的已销号结果；整改期间发现偷返请使用“偷返复查”');
    const result: AcceptanceResult = body.result || (isSneak ? AcceptanceResult.FAIL : AcceptanceResult.PASS);
    if (!body.result && !isSneak) throw new BadRequestException('请选择复查结论');

    await this.dataSource.transaction(async (m) => {
      // 偷返复查：逐人确认谁在整改期间返回/偷返经营
      const sneakIds: string[] = [];
      if (isSneak) {
        const targets = (body.personIds || []) as string[];
        if (!targets.length) throw new BadRequestException('请勾选现场确认擅自返回/偷返经营的人员');
        for (const pid of targets) {
          const p = await m.findOne(EvacuationPerson, { where: { id: pid } });
          if (!p) continue;
          p.evacStatus = PersonEvacStatus.SNEAK_BACK;
          p.sneakReturnedAt = new Date();
          if (body.operatingDetected) p.stillOperating = true;
          await m.save(p);
          sneakIds.push(pid);
        }
      }

      await m.save(
        m.create(RecheckRecord, {
          houseId: house.id,
          result,
          reboundNotes: body.reboundNotes || '',
          wallCrack: body.wallCrack ?? null,
          roofLeak: body.roofLeak ?? null,
          foundationSettlement: body.foundationSettlement ?? null,
          checkedAt: new Date(),
          inspectorId: u.sub,
          sneakReturn: isSneak,
          sneakPersonIds: sneakIds,
          photos: body.photos || [],
        }),
      );

      if (result === AcceptanceResult.FAIL) {
        // 无论房屋是已销号还是整改中：偷返/反弹都接着原事件处理，不新建档案
        const reason = isSneak
          ? `整改期间复查发现人员擅自返回/偷返经营（${sneakIds.length} 人）：${body.reboundNotes || '现场发现人员返回房屋'}`
          : `销号后复查发现问题反弹：${body.reboundNotes || '隐患重新出现'}`;
        if (activeClose) {
          await this.invalidateActiveClose(m, house.id, isSneak ? '复查发现整改期间人员偷返，旧销号结果作废，按原事件重新处置' : '复查发现问题反弹，旧销号结果作废', u);
        }
        house.status = HouseStatus.REBOUND;
        house.stopUseConfirmed = false;
        // 回写最新隐患
        if (body.wallCrack != null) house.wallCrack = Number(body.wallCrack);
        if (body.roofLeak != null) house.roofLeak = Number(body.roofLeak);
        if (body.foundationSettlement != null) house.foundationSettlement = Number(body.foundationSettlement);
        await m.save(house);
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: isSneak ? IssueType.SNEAK_RETURN : IssueType.REBOUND,
            description: reason,
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
            kind: 'RECHECK',
            title: isSneak
              ? `偷返复查：确认 ${sneakIds.length} 人擅自返回，${activeClose ? '旧销号已作废，' : ''}原事件重新处置`
              : '复查发现问题反弹，重新纳入治理',
            detail: body.reboundNotes || '',
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      } else {
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id,
            kind: 'RECHECK',
            title: '复查通过，保持销号',
            detail: body.reboundNotes || '',
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      }
    });
    // 复查结论（尤其偷返）改变花名册口径后，事务外重新汇总并回写房屋清退/停业标记
    if (result === AcceptanceResult.FAIL) {
      const rollup = await this.evacuationRollup(house.id);
      await this.dataSource.transaction(async (m) => {
        const h = await m.findOne(House, { where: { id: house.id } });
        await this.syncHouseEvictionState(m, h, rollup);
      });
    }
    return { ok: true };
  }

  // ---------- 安置补助（过渡期生活补助）----------
  async submitAid(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    const plan = await this.latestPlan(houseId);
    if (!plan) throw new BadRequestException('尚未下达整改方案，不能申请安置补助');
    const rollup = await this.evacuationRollup(houseId);
    if (rollup.registered === 0) throw new BadRequestException('尚未建立转移人员花名册，不能核算安置补助');
    if (rollup.relocated + rollup.returned === 0) throw new BadRequestException('尚无人员确认离开并安置，不能申请安置补助');
    const personDays = Number(body.personDays) > 0 ? Number(body.personDays) : 0;
    if (personDays <= 0) throw new BadRequestException('请填写实际安置人天');
    let amount = Math.round(personDays * AID_RATE_PER_DAY * 100) / 100;
    if (amount > AID_CAP) amount = AID_CAP;

    let aid = await this.aids.findOne({ where: { houseId } });
    if (!aid) aid = this.aids.create({ houseId, applicantId: u.sub });
    if ([AidStatus.PAID].includes(aid.status)) throw new BadRequestException('安置补助已拨付，不能重复申请');
    aid.personDays = personDays;
    aid.amount = amount.toFixed(2);
    aid.applicantId = u.sub;
    aid.status = AidStatus.APPLIED;
    aid.reviewComment = null;
    aid = await this.aids.save(aid);
    await this.logActivity(houseId, 'SUBSIDY', `安置补助申请：${personDays} 人天，¥${amount.toFixed(2)}`, '乡镇核定金额；拨付须在销号后', u);
    return { aid, amount, personDays };
  }

  async reviewAid(u: CurrentUser, id: string, body: any) {
    const aid = await this.aids.findOne({ where: { id } });
    if (!aid) throw new NotFoundException();
    if (aid.status !== AidStatus.APPLIED) throw new BadRequestException('仅待核定的安置补助可审核');
    aid.status = body.approved ? AidStatus.APPROVED : AidStatus.REJECTED;
    aid.reviewComment = body.comment || (body.approved ? '核定通过' : '不予核定');
    aid.reviewedById = u.sub;
    aid.reviewedAt = new Date();
    await this.aids.save(aid);
    await this.logActivity(aid.houseId, 'SUBSIDY', body.approved ? `安置补助已核定 ¥${aid.amount}（销号后拨付）` : '安置补助核定未通过', aid.reviewComment, u);
    return aid;
  }

  async payAid(u: CurrentUser, id: string) {
    const aid = await this.aids.findOne({ where: { id } });
    if (!aid) throw new NotFoundException();
    if (aid.status !== AidStatus.APPROVED) throw new BadRequestException('仅已核定的安置补助可拨付');
    const close = await this.latestValidClose(aid.houseId);
    if (!close) throw new BadRequestException('房屋未销号或原销号已作废，安置补助不得拨付');
    aid.status = AidStatus.PAID;
    aid.paidAt = new Date();
    await this.aids.save(aid);
    await this.logActivity(aid.houseId, 'SUBSIDY', `安置补助已拨付 ¥${aid.amount}`, '销号有效后拨付', u);
    return aid;
  }

  // ---------- 经营损失登记与核定 ----------
  async submitLoss(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    if (!house.isBusiness) throw new BadRequestException('该房屋档案未登记经营行为');
    if (!body.businessName) throw new BadRequestException('请填写经营字号/业态');
    const closedDays = Number(body.closedDays) > 0 ? Number(body.closedDays) : 0;
    const claimed = Number(body.claimedAmount) > 0 ? Number(body.claimedAmount) : 0;
    if (closedDays <= 0) throw new BadRequestException('请填写停业天数');
    const loss = this.losses.create({
      houseId,
      businessName: body.businessName,
      operatorName: body.operatorName || null,
      monthlyRevenue: Number(body.monthlyRevenue || 0).toFixed(2),
      closedDays,
      claimedAmount: claimed.toFixed(2),
      verifiedAmount: '0.00',
      proofDocs: body.proofDocs || [],
      status: LossStatus.REPORTED,
      applicantId: u.sub,
    });
    const rec = await this.losses.save(loss);
    await this.logActivity(houseId, 'SUBSIDY', `经营损失申报：${rec.businessName}，停业 ${closedDays} 天，申报 ¥${rec.claimedAmount}`, '待乡镇核定', u);
    return rec;
  }

  async reviewLoss(u: CurrentUser, id: string, body: any) {
    const loss = await this.losses.findOne({ where: { id } });
    if (!loss) throw new NotFoundException();
    if (![LossStatus.REPORTED, LossStatus.REJECTED].includes(loss.status)) throw new BadRequestException('当前状态不可核定');
    if (body.approved && !(Number(body.verifiedAmount) >= 0)) throw new BadRequestException('请填写核定金额');
    loss.status = body.approved ? LossStatus.VERIFIED : LossStatus.REJECTED;
    loss.verifiedAmount = body.approved ? Number(body.verifiedAmount).toFixed(2) : '0.00';
    loss.verifyComment = body.comment || (body.approved ? '核定通过' : '不予认定');
    loss.verifiedAt = new Date();
    loss.verifiedById = u.sub;
    await this.losses.save(loss);
    await this.logActivity(loss.houseId, 'SUBSIDY', body.approved ? `经营损失核定 ¥${loss.verifiedAmount}（${loss.businessName}）` : '经营损失不予认定', loss.verifyComment, u);
    return loss;
  }

  // ---------- 复营业核准（何时允许恢复营业）----------
  async applyResumption(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    if (!house.isBusiness) throw new BadRequestException('该房屋未登记经营行为，无复营业事项');
    const close = await this.latestValidClose(houseId);
    if (!close) throw new BadRequestException('房屋尚未完成有效销号，不得申请恢复营业');
    const r = await this.resumptions.save(
      this.resumptions.create({
        houseId,
        businessName: body.businessName || house.usage,
        applicantName: body.applicantName || u.name,
        applyReason: body.applyReason || '',
        photos: body.photos || [],
        appliedAt: new Date(),
        status: ResumptionStatus.APPLIED,
        applicantId: u.sub,
      }),
    );
    await this.logActivity(houseId, 'SUBSIDY', `提交复营业申请：${r.businessName}`, r.applyReason, u);
    return r;
  }

  async reviewResumption(u: CurrentUser, id: string, body: any) {
    const r = await this.resumptions.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.status !== ResumptionStatus.APPLIED) throw new BadRequestException('该复营业申请已处理');
    if (body.approved) {
      const close = await this.latestValidClose(r.houseId);
      if (!close) throw new BadRequestException('房屋无有效销号，不得核准复营业');
      if (!body.resumeFrom) throw new BadRequestException('请填写核准恢复营业的起始日期');
    }
    r.status = body.approved ? ResumptionStatus.APPROVED : ResumptionStatus.REJECTED;
    r.reviewComment = body.comment || (body.approved ? '同意恢复营业' : '不同意恢复营业');
    r.resumeFrom = body.approved ? body.resumeFrom : null;
    r.reviewedAt = new Date();
    r.reviewedById = u.sub;
    await this.resumptions.save(r);
    await this.logActivity(
      r.houseId,
      'SUBSIDY',
      body.approved ? `核准复营业：${r.businessName} 自 ${r.resumeFrom} 起恢复营业` : `复营业申请未核准：${r.businessName}`,
      r.reviewComment,
      u,
    );
    return r;
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
      inspections, plans, notices, evacuations, persons, stakeholders, consultations, issues,
      family, cplan, subsidy, logs, acceptances, closes, rechecks, activities, aid, lossList, resumptionList,
    ] = await Promise.all([
      this.inspections.find({ where: { houseId: id }, order: { inspectedAt: 'DESC' } }),
      this.plans.find({ where: { houseId: id }, order: { reviewedAt: 'DESC' }, relations: ['items'] }),
      this.notices.find({ where: { houseId: id }, order: { notifiedAt: 'DESC' } }),
      this.evacuations.find({ where: { houseId: id }, order: { settledAt: 'DESC' } }),
      this.persons.find({ where: { houseId: id }, order: { createdAt: 'ASC' } }),
      this.stakeholders.find({ where: { houseId: id } }),
      this.consultations.find({ where: { houseId: id }, order: { heldAt: 'DESC' } }),
      this.issues.find({ where: { houseId: id }, order: { raisedAt: 'DESC' } }),
      this.families.findOne({ where: { houseId: id } }),
      this.cplans.findOne({ where: { houseId: id }, relations: ['budgetItems'] }),
      this.subsidies.findOne({ where: { houseId: id } }),
      this.logs.find({ where: { houseId: id }, order: { recordedAt: 'DESC' } }),
      this.acceptances.find({ where: { houseId: id }, order: { acceptedAt: 'DESC' }, relations: ['itemResults'] }),
      this.closes.find({ where: { houseId: id }, order: { closedAt: 'DESC' } }),
      this.rechecks.find({ where: { houseId: id }, order: { checkedAt: 'DESC' } }),
      this.activities.find({ where: { houseId: id }, order: { createdAt: 'DESC' }, take: 200 }),
      this.aids.findOne({ where: { houseId: id } }),
      this.losses.find({ where: { houseId: id }, order: { createdAt: 'DESC' } }),
      this.resumptions.find({ where: { houseId: id }, order: { appliedAt: 'DESC' } }),
    ]);
    const blockingIssues = issues.filter((i) => i.blocksWorkflow && i.status !== IssueStatus.RESOLVED);
    const evacRollup = await this.evacuationRollup(id);
    const close = closes.find((c) => !c.invalidated) || null;
    return {
      house, inspections, plans, notices, evacuations, evacPersons: persons, evacRollup,
      stakeholders, consultations, issues, blockingIssues,
      family, constructionPlan: cplan, subsidy, constructionLogs: logs, acceptances,
      closes, close, closeInvalidated: closes.some((c) => c.invalidated),
      rechecks, activities, aid, businessLosses: lossList, resumptions: resumptionList,
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
    // 方案要求紧急转移的房屋集合：未全员清退不得计入“真正停用/处置”
    const evacRequiredRows = await this.plans
      .createQueryBuilder('p')
      .select('DISTINCT p."houseId"', 'houseId')
      .where('p."evacuationRequired" = true')
      .getRawMany<{ houseId: string }>();
    const evacRequiredSet = new Set(evacRequiredRows.map((r) => r.houseId));
    const disposedStatuses = [HouseStatus.STOPPED, HouseStatus.EVACUATED, HouseStatus.RECTIFYING, HouseStatus.PENDING_ACCEPTANCE, HouseStatus.CLOSED, HouseStatus.ACCEPTANCE_FAILED];
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
        const reallyDisposed = disposedStatuses.includes(h.status) && !(evacRequiredSet.has(h.id) && !h.evictionCleared);
        if (reallyDisposed) highRiskStopped++;
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

    // 高风险但未真正停用的房屋（县级最关注）：状态未处置，或虽处置但紧急转移房屋花名册未全员清退
    const qbStopped = this.houses
      .createQueryBuilder('h')
      .where('h.riskLevel IN (:...rs)', { rs: [RiskLevel.SUSPEND, RiskLevel.EVACUATE] })
      .andWhere('(h.status NOT IN (:...ss) OR (h.id IN (:...evIds) AND h."evictionCleared" = false))', {
        ss: disposedStatuses,
        evIds: evacRequiredRows.length ? evacRequiredRows.map((r) => r.houseId) : ['00000000-0000-0000-0000-000000000000'],
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

    // 人员转移清退口径（逐人花名册）
    const evacHouses = await this.houses
      .createQueryBuilder('h')
      .innerJoin(ReviewPlan, 'p', 'p."houseId"::text = h.id::text AND p."evacuationRequired" = true')
      .where(township ? 'h.township = :t' : '1=1', township ? { t: township } : {})
      .getMany();
    const allPersons = await this.persons.find();
    let evacClearedHouses = 0, evacPartialHouses = 0, evacRosterHouses = 0;
    let personsRelocated = 0, personsStaying = 0, personsSneakBack = 0, personsReturned = 0;
    const partialEvacHouses: { id: string; code: string; township: string; village: string; ownerName: string; registered: number; relocated: number; unresolved: number }[] = [];
    for (const h of evacHouses) {
      const r = await this.evacuationRollup(h.id);
      if (r.registered === 0) {
        evacPartialHouses++;
        partialEvacHouses.push({ id: h.id, code: h.code, township: h.township, village: h.village, ownerName: h.ownerName, registered: 0, relocated: 0, unresolved: 0 });
        continue;
      }
      evacRosterHouses++;
      personsRelocated += r.relocated;
      personsStaying += r.staying;
      personsSneakBack += r.sneakBack;
      personsReturned += r.returned;
      if (r.cleared) evacClearedHouses++;
      else {
        evacPartialHouses++;
        partialEvacHouses.push({ id: h.id, code: h.code, township: h.township, village: h.village, ownerName: h.ownerName, registered: r.registered, relocated: r.relocated, unresolved: r.unresolved });
      }
    }

    // 安置补助拨付监督
    const aidQb = this.aids.createQueryBuilder('a').leftJoin(House, 'h2', 'h2.id::text = a."houseId"::text');
    if (township) aidQb.andWhere('h2.township = :t', { t: township });
    const aids = await aidQb.getMany();
    const aidSummary = { applied: 0, approved: 0, paid: 0, rejected: 0, paidAmount: 0 };
    for (const a of aids) {
      if (a.status === AidStatus.APPLIED) aidSummary.applied++;
      if (a.status === AidStatus.APPROVED) aidSummary.approved++;
      if (a.status === AidStatus.REJECTED) aidSummary.rejected++;
      if (a.status === AidStatus.PAID) { aidSummary.paid++; aidSummary.paidAmount += Number(a.amount); }
    }

    // 经营损失与复营业
    const lossQb = this.losses.createQueryBuilder('l').leftJoin(House, 'h3', 'h3.id::text = l."houseId"::text');
    if (township) lossQb.andWhere('h3.township = :t', { t: township });
    const lossesAll = await lossQb.getMany();
    const resumptionQb = this.resumptions.createQueryBuilder('r').leftJoin(House, 'h4', 'h4.id::text = r."houseId"::text');
    if (township) resumptionQb.andWhere('h4.township = :t', { t: township });
    const resumptionsAll = await resumptionQb.getMany();
    const businessSummary = {
      lossReported: lossesAll.length,
      lossVerified: lossesAll.filter((l) => l.status === LossStatus.VERIFIED).length,
      resumptionApplied: resumptionsAll.filter((r) => r.status === ResumptionStatus.APPLIED).length,
      resumptionApproved: resumptionsAll.filter((r) => r.status === ResumptionStatus.APPROVED).length,
    };

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
      itemByType,
      closureRate: houses.length ? Number((closed / houses.length).toFixed(2)) : 0,
      evacuationSummary: {
        requiredHouses: evacHouses.length,
        rosterHouses: evacRosterHouses,
        clearedHouses: evacClearedHouses,
        partialHouses: evacPartialHouses,
        personsRelocated,
        personsStaying,
        personsSneakBack,
        personsReturned,
        partialEvacHouses,
      },
      aidSummary,
      businessSummary,
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
    EVACUATED: '已转移', RECTIFYING: '整改中', PENDING_ACCEPTANCE: '待销号', ACCEPTANCE_FAILED: '验收不通过',
    CLOSED: '已销号', REBOUND: '问题反弹', REFUSED: '拒绝整改',
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
    RAIN_SEASON: '雨季风险加重', TENANT_REFUSE: '租户不愿搬离', ACCEPTANCE_FAIL: '验收不通过',
    REBOUND: '复查发现问题反弹', SNEAK_RETURN: '整改期间擅自返回/偷返经营',
  }[t] || t;
}
export function personCategoryLabel(t: string) {
  return {
    OWNER: '户主/家庭成员', RESIDENT: '常住人员', TENANT: '租户', OPERATOR: '经营者', WORKER: '从业人员',
  }[t] || t;
}
export function personEvacStatusLabel(s: string) {
  return {
    REGISTERED: '待现场核对', RELOCATED: '已确认离开并安置', STAYING: '仍在房屋内',
    SNEAK_BACK: '擅自返回', RETURNED: '准许后安全返回',
  }[s] || s;
}
export function aidStatusLabel(s: string) {
  return { APPLIED: '待核定', APPROVED: '已核定（待销号拨付）', PAID: '已拨付', REJECTED: '不予核定' }[s] || s;
}
export function lossStatusLabel(s: string) {
  return { REPORTED: '待核定', VERIFIED: '已核定', REJECTED: '不予认定' }[s] || s;
}
export function resumptionStatusLabel(s: string) {
  return { NONE: '未申请', APPLIED: '待核准', APPROVED: '已核准复营业', REJECTED: '未核准' }[s] || s;
}
export function difficultyLabel(d: string) {
  return {
    NONE: '无', LOW_INCOME: '低保户', FIVE_GUARANTEE: '五保户', DISABLED: '残疾人家庭',
    MONITORING: '防止返贫监测户', VETERAN: '优抚对象',
  }[d] || d;
}
