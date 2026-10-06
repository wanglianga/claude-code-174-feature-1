import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

// ---------- 枚举 ----------
export enum UserRole {
  GRID_WORKER = 'GRID_WORKER', // 网格员
  TOWNSHIP_REVIEWER = 'TOWNSHIP_REVIEWER', // 乡镇住建人员
  COUNTY_ADMIN = 'COUNTY_ADMIN', // 县级主管部门
  FARMER = 'FARMER', // 农户
  TEAM = 'TEAM', // 施工队
  ACCEPTOR = 'ACCEPTOR', // 验收人员
}

export enum RiskLevel {
  NORMAL = 'NORMAL', // 一般关注
  RECTIFY = 'RECTIFY', // 限期整改
  SUSPEND = 'SUSPEND', // 暂停使用
  EVACUATE = 'EVACUATE', // 紧急转移
}

export enum HouseStatus {
  PENDING_REVIEW = 'PENDING_REVIEW', // 待复核
  IN_PLAN = 'IN_PLAN', // 已复核/方案中
  NOTIFIED = 'NOTIFIED', // 已告知
  STOPPED = 'STOPPED', // 已停用
  EVACUATED = 'EVACUATED', // 已转移
  RECTIFYING = 'RECTIFYING', // 整改中
  PENDING_ACCEPTANCE = 'PENDING_ACCEPTANCE', // 待验收
  ACCEPTANCE_FAILED = 'ACCEPTANCE_FAILED', // 验收不通过
  CLOSED = 'CLOSED', // 已销号
  REBOUND = 'REBOUND', // 复查反弹/重新治理
  REFUSED = 'REFUSED', // 农户拒绝整改
}

export enum ItemType {
  REMOVE_ILLEGAL_FLOOR = 'REMOVE_ILLEGAL_FLOOR', // 拆除违建加层
  REINFORCE_WALL = 'REINFORCE_WALL', // 加固承重墙
  REPAIR_ROOF = 'REPAIR_ROOF', // 修复屋面
  EVICT_TENANTS = 'EVICT_TENANTS', // 清退经营租户
  SET_WARNING = 'SET_WARNING', // 设置警示
  TEMP_RESETTLEMENT = 'TEMP_RESETTLEMENT', // 安排临时安置
}

export enum ItemStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export enum IssueType {
  FARMER_REFUSE = 'FARMER_REFUSE', // 农户拒绝整改
  MATERIAL_SWAP = 'MATERIAL_SWAP', // 施工队偷换材料
  SUBSIDY_DISPUTE = 'SUBSIDY_DISPUTE', // 补助资格争议
  RAIN_SEASON = 'RAIN_SEASON', // 雨季风险加重
  TENANT_REFUSE = 'TENANT_REFUSE', // 租户不愿搬离
  ACCEPTANCE_FAIL = 'ACCEPTANCE_FAIL', // 验收不通过
  REBOUND = 'REBOUND', // 复查发现问题反弹
  SNEAK_RETURN = 'SNEAK_RETURN', // 整改期间擅自返回/偷返经营
}

export enum IssueStatus {
  OPEN = 'OPEN',
  RESOLVING = 'RESOLVING',
  RESOLVED = 'RESOLVED',
}

export enum StakeholderType {
  OWNER = 'OWNER', // 户主
  TENANT = 'TENANT', // 租户
  OPERATOR = 'OPERATOR', // 经营者
  ELDER = 'ELDER', // 老人家庭成员
  CADRE = 'CADRE', // 村干部
}

export enum Stance {
  SUPPORT = 'SUPPORT',
  NEUTRAL = 'NEUTRAL',
  OPPOSE = 'OPPOSE',
  UNKNOWN = 'UNKNOWN',
}

export enum DifficultyType {
  NONE = 'NONE',
  LOW_INCOME = 'LOW_INCOME', // 低保
  FIVE_GUARANTEE = 'FIVE_GUARANTEE', // 五保
  DISABLED = 'DISABLED', // 残疾
  MONITORING = 'MONITORING', // 防止返贫监测户
  VETERAN = 'VETERAN', // 优抚对象
}

export enum SubsidyStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
}

export enum AcceptanceResult {
  PASS = 'PASS',
  FAIL = 'FAIL',
}

// ---------- 人员转移花名册：人员类别 ----------
export enum PersonCategory {
  OWNER = 'OWNER', // 户主/家庭成员
  RESIDENT = 'RESIDENT', // 常住人员
  TENANT = 'TENANT', // 租户
  OPERATOR = 'OPERATOR', // 经营者
  WORKER = 'WORKER', // 从业人员/雇工
}

// ---------- 转移花名册：逐人状态 ----------
export enum PersonEvacStatus {
  REGISTERED = 'REGISTERED', // 已登记、待现场核对
  RELOCATED = 'RELOCATED', // 已确认离开并安置
  STAYING = 'STAYING', // 现场核对仍在房屋内（未离开）
  SNEAK_BACK = 'SNEAK_BACK', // 曾离开，整改期间擅自返回
  RETURNED = 'RETURNED', // 销号准许后安全返回
}

// ---------- 安置补助状态 ----------
export enum AidStatus {
  APPLIED = 'APPLIED', // 已申请
  APPROVED = 'APPROVED', // 乡镇核定（拨付须销号）
  PAID = 'PAID', // 已拨付
  REJECTED = 'REJECTED',
}

// ---------- 经营损失登记状态 ----------
export enum LossStatus {
  REPORTED = 'REPORTED', // 已申报
  VERIFIED = 'VERIFIED', // 乡镇核定
  REJECTED = 'REJECTED',
}

// ---------- 复营业核准状态 ----------
export enum ResumptionStatus {
  NONE = 'NONE', // 未申请
  APPLIED = 'APPLIED', // 经营者申请
  APPROVED = 'APPROVED', // 已核准复营业
  REJECTED = 'REJECTED',
}

// ---------- 用户 ----------
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  username: string;
  @Column()
  passwordHash: string;
  @Column()
  name: string;
  @Column({ type: 'varchar', length: 32 })
  role: UserRole;
  @Column({ nullable: true })
  township: string; // 所属乡镇
  @Column({ nullable: true })
  phone: string;
  @Column({ nullable: true })
  teamId: string;
}

// ---------- 房屋（档案主表）----------
@Entity('houses')
export class House {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  code: string; // 房屋档案编号
  @Column()
  township: string; // 乡镇
  @Column()
  village: string; // 行政村
  @Column()
  address: string;
  @Column({ type: 'float', nullable: true })
  lng: number;
  @Column({ type: 'float', nullable: true })
  lat: number;
  @Column()
  ownerName: string;
  @Column({ nullable: true })
  idCard: string;
  @Column({ nullable: true })
  ownerPhone: string;

  // 巡查登记的房屋属性（以最新巡查为准）
  @Column({ type: 'int' })
  buildYear: number;
  @Column({ type: 'int' })
  floors: number;
  @Column({ default: '住宅' })
  usage: string; // 使用用途
  @Column({ default: false })
  isBusiness: boolean; // 是否经营
  @Column({ default: false })
  isRented: boolean; // 是否出租
  @Column({ default: false })
  isAddedFloor: boolean; // 是否加层（疑似违建加层）
  @Column({ type: 'int', default: 0 })
  wallCrack: number; // 墙体裂缝 0无 1明显 2严重
  @Column({ type: 'int', default: 0 })
  roofLeak: number; // 屋面渗漏 0无 1局部 2严重
  @Column({ type: 'int', default: 0 })
  foundationSettlement: number; // 地基沉降 0无 1明显 2严重
  @Column({ type: 'int', default: 0 })
  residents: number; // 居住人数

  // 人员转移花名册口径（网格员现场逐人核对后回写）
  @Column({ type: 'int', default: 0 })
  registeredCount: number; // 档案登记应转移人数（花名册人数）
  @Column({ default: false })
  evictionCleared: boolean; // 是否全员清退：花名册全员确认离开才为 true
  @Column({ default: false })
  businessClosed: boolean; // 经营行为是否已实际停止（仍在经营则为 false）

  @Column({ type: 'varchar', length: 16, default: RiskLevel.NORMAL })
  riskLevel: RiskLevel;
  @Column({ type: 'varchar', length: 32, default: HouseStatus.PENDING_REVIEW })
  status: HouseStatus;
  @Column({ type: 'simple-json', nullable: true })
  ruleReasons: string[]; // 最新风险判定依据
  @Column({ default: false })
  stopUseConfirmed: boolean; // 是否已确认停用（封停/警示核查）
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 巡查记录 ----------
@Entity('inspections')
export class Inspection {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => House, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'houseId' })
  house: House;
  @Column()
  houseId: string;
  @Column()
  inspectorId: string;
  @Column({ nullable: true })
  inspectorName: string;
  @Column({ type: 'timestamptz' })
  inspectedAt: Date;
  @Column({ type: 'int' })
  buildYear: number;
  @Column({ type: 'int' })
  floors: number;
  @Column()
  usage: string;
  @Column({ default: false })
  isBusiness: boolean;
  @Column({ default: false })
  isRented: boolean;
  @Column({ default: false })
  isAddedFloor: boolean;
  @Column({ type: 'int', default: 0 })
  wallCrack: number;
  @Column({ type: 'int', default: 0 })
  roofLeak: number;
  @Column({ type: 'int', default: 0 })
  foundationSettlement: number;
  @Column({ type: 'int', default: 0 })
  residents: number;
  @Column({ default: false })
  rainSeason: boolean; // 巡查时正值雨季/降雨后险情加重
  @Column({ type: 'varchar', length: 16 })
  riskLevel: RiskLevel;
  @Column({ type: 'simple-json' })
  reasons: string[];
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
  @Column({ type: 'text', nullable: true })
  notes: string;
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 复核与整改方案 ----------
@Entity('review_plans')
export class ReviewPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  inspectionId: string;
  @Column()
  reviewerId: string;
  @Column({ nullable: true })
  reviewerName: string;
  @Column({ type: 'timestamptz' })
  reviewedAt: Date;
  @Column({ type: 'varchar', length: 16 })
  decision: RiskLevel; // 复核确认的风险等级
  @Column({ type: 'text', nullable: true })
  requirement: string; // 整改总体要求
  @Column({ type: 'date' })
  deadline: string; // 整改期限
  @Column({ default: false })
  stopUseRequired: boolean; // 必须暂停使用
  @Column({ default: false })
  evacuationRequired: boolean; // 必须紧急转移
  @OneToMany(() => RectificationItem, (i) => i.plan, { cascade: true })
  items: RectificationItem[];
  @CreateDateColumn()
  createdAt: Date;
}

@Entity('rectification_items')
export class RectificationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => ReviewPlan, (p) => p.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planId' })
  plan: ReviewPlan;
  @Column()
  planId: string;
  @Column({ type: 'varchar', length: 32 })
  type: ItemType;
  @Column({ type: 'text' })
  description: string;
  @Column({ default: true })
  required: boolean;
  @Column({ type: 'varchar', length: 16, default: ItemStatus.PENDING })
  status: ItemStatus;
}

// ---------- 风险告知 ----------
@Entity('notice_records')
export class NoticeRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ nullable: true })
  planId: string;
  @Column()
  method: string; // 书面送达 / 现场告知 / 电话告知
  @Column({ type: 'simple-json' })
  notifiedTo: string[]; // 被告知人：户主、租户、经营者
  @Column({ type: 'timestamptz' })
  notifiedAt: Date;
  @Column({ default: false })
  acknowledged: boolean; // 是否签收确认
  @Column({ type: 'simple-json', nullable: true })
  signPhotos: string[];
  @Column({ type: 'text', nullable: true })
  content: string;
  @Column()
  recorderId: string;
}

// ---------- 人员转移与临时安置 ----------
@Entity('evacuation_records')
export class EvacuationRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'int' })
  residents: number; // 本次登记转移人数（批次合计）
  @Column()
  destination: string; // 投亲靠友 / 村部安置点 / 乡镇集中安置点
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
  @Column({ type: 'timestamptz' })
  settledAt: Date;
  @Column({ type: 'timestamptz', nullable: true })
  returnedAt: Date; // 安全整改后返回时间
  @Column({ default: false })
  allowReturn: boolean; // 是否准许返回（验收通过前不得返回）
  @Column()
  recorderId: string;
  @Column({ type: 'text', nullable: true })
  remark: string;
}

// ---------- 人员转移花名册（逐人现场核对，清退口径依据）----------
@Entity('evacuation_persons')
export class EvacuationPerson {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  name: string; // 姓名
  @Column({ type: 'varchar', length: 16, default: PersonCategory.RESIDENT })
  category: PersonCategory; // 户主/常住/租户/经营者/从业人员
  @Column({ nullable: true })
  phone: string;
  @Column({ type: 'varchar', length: 16, default: PersonEvacStatus.REGISTERED })
  evacStatus: PersonEvacStatus;
  @Column({ nullable: true })
  destination: string; // 去了哪个安置点（投亲靠友/村部安置点/乡镇集中安置点/具体名称）
  @Column({ type: 'date', nullable: true })
  settledFrom: string; // 从哪天开始安置
  @Column({ default: false })
  stillOperating: boolean; // 是否仍在继续经营（经营者/从业人员）
  @Column({ type: 'simple-json', nullable: true })
  photos: string[]; // 现场核对照片
  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date; // 网格员现场核对时间
  @Column({ nullable: true })
  verifiedById: string;
  @Column({ nullable: true })
  verifiedByName: string;
  @Column({ type: 'text', nullable: true })
  remark: string;
  @Column({ type: 'timestamptz', nullable: true })
  sneakReturnedAt: Date; // 擅自返回被复查确认的时间
  @Column({ type: 'timestamptz', nullable: true })
  returnedAt: Date; // 销号准许后安全返回时间
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 安置补助（人员转移后的过渡期生活补助）----------
@Entity('resettlement_aids')
export class ResettlementAid {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'int', default: 0 })
  personDays: number; // 核补人天
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount: string; // 核定金额
  @Column({ type: 'varchar', length: 16, default: AidStatus.APPLIED })
  status: AidStatus;
  @Column({ type: 'text', nullable: true })
  reviewComment: string;
  @Column({ nullable: true })
  reviewedById: string;
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date;
  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date;
  @Column()
  applicantId: string;
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 经营损失登记（停业期间经营损失补助依据）----------
@Entity('business_losses')
export class BusinessLoss {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  businessName: string; // 经营字号/业态
  @Column({ nullable: true })
  operatorName: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  monthlyRevenue: string; // 申报月均营业额
  @Column({ type: 'int', default: 0 })
  closedDays: number; // 申报停业天数
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  claimedAmount: string; // 申报损失
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  verifiedAmount: string; // 乡镇核定金额
  @Column({ type: 'simple-json', nullable: true })
  proofDocs: string[]; // 证照/流水等证明
  @Column({ type: 'varchar', length: 16, default: LossStatus.REPORTED })
  status: LossStatus;
  @Column({ type: 'text', nullable: true })
  verifyComment: string;
  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date;
  @Column({ nullable: true })
  verifiedById: string;
  @Column()
  applicantId: string;
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 复营业核准（何时允许恢复营业）----------
@Entity('business_resumptions')
export class BusinessResumption {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ nullable: true })
  businessName: string;
  @Column({ nullable: true })
  applicantName: string;
  @Column({ type: 'text', nullable: true })
  applyReason: string;
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
  @Column({ type: 'timestamptz' })
  appliedAt: Date;
  @Column({ type: 'varchar', length: 16, default: ResumptionStatus.APPLIED })
  status: ResumptionStatus;
  @Column({ type: 'text', nullable: true })
  reviewComment: string;
  @Column({ type: 'date', nullable: true })
  resumeFrom: string; // 核准自何日起恢复营业
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date;
  @Column({ nullable: true })
  reviewedById: string;
  @Column()
  applicantId: string;
}

// ---------- 利益相关方与协商 ----------
@Entity('stakeholders')
export class Stakeholder {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 16 })
  type: StakeholderType;
  @Column()
  name: string;
  @Column({ nullable: true })
  phone: string;
  @Column({ type: 'varchar', length: 16, default: Stance.UNKNOWN })
  stance: Stance;
  @Column({ type: 'text', nullable: true })
  influenceNote: string; // 对整改进度的影响（如老人不愿搬、租户租期未到）
}

@Entity('consultations')
export class Consultation {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  topic: string;
  @Column({ type: 'simple-json' })
  attendeeIds: string[];
  @Column({ type: 'text' })
  outcome: string; // 协商结果
  @Column({ type: 'timestamptz' })
  heldAt: Date;
  @Column()
  recorderId: string;
}

// ---------- 异常事件 ----------
@Entity('issue_records')
export class IssueRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 32 })
  type: IssueType;
  @Column({ type: 'text' })
  description: string;
  @Column({ type: 'varchar', length: 16, default: IssueStatus.OPEN })
  status: IssueStatus;
  @Column({ type: 'boolean', default: false })
  blocksWorkflow: boolean; // 是否阻断当前环节
  @Column()
  raisedById: string;
  @Column({ nullable: true })
  raisedByName: string;
  @Column({ type: 'timestamptz' })
  raisedAt: Date;
  @Column({ type: 'text', nullable: true })
  resolution: string;
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;
}

// ---------- 家庭困难类型与房屋权属 ----------
@Entity('family_profiles')
export class FamilyProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  houseId: string;
  @Column({ type: 'varchar', length: 24, default: DifficultyType.NONE })
  difficultyType: DifficultyType;
  @Column({ type: 'simple-json', nullable: true })
  difficultyProof: string[]; // 困难证明材料
  @Column({ default: '自有' })
  ownershipType: string; // 自有/继承/共有
  @Column({ type: 'simple-json', nullable: true })
  ownershipProof: string[]; // 权属证明材料
  @Column({ default: false })
  ownerConsent: boolean; // 户主是否同意整改
  @Column({ type: 'text', nullable: true })
  membersNote: string; // 家庭成员情况（老人、病患等）
}

// ---------- 施工队 ----------
@Entity('construction_teams')
export class ConstructionTeam {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  name: string;
  @Column({ nullable: true })
  qualificationNo: string; // 资质证书编号
  @Column({ type: 'simple-json', nullable: true })
  qualificationDoc: string[];
  @Column({ default: false })
  qualified: boolean; // 资质是否在有效期内且与施工内容相符
  @Column({ nullable: true })
  contact: string;
  @Column({ nullable: true })
  phone: string;
  @Column({ type: 'text', nullable: true })
  scope: string;
}

// ---------- 施工计划与预算明细 ----------
@Entity('construction_plans')
export class ConstructionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  houseId: string;
  @Column({ nullable: true })
  teamId: string;
  @Column({ nullable: true })
  teamName: string;
  @Column({ type: 'date' })
  startDate: string;
  @Column({ type: 'date' })
  endDate: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  budgetTotal: string;
  @Column({ type: 'text', nullable: true })
  description: string;
  @OneToMany(() => BudgetItem, (b) => b.plan, { cascade: true })
  budgetItems: BudgetItem[];
  @CreateDateColumn()
  createdAt: Date;
}

@Entity('budget_items')
export class BudgetItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => ConstructionPlan, (p) => p.budgetItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planId' })
  plan: ConstructionPlan;
  @Column()
  planId: string;
  @Column()
  name: string; // 材料/工程项目
  @Column({ nullable: true })
  spec: string; // 规格型号（材料核验依据）
  @Column({ type: 'float' })
  qty: number;
  @Column()
  unit: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  unitPrice: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;
}

// ---------- 补助申请 ----------
@Entity('subsidy_applications')
export class SubsidyApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  houseId: string;
  @Column({ nullable: true })
  planId: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount: string;
  @Column({ type: 'varchar', length: 24, default: DifficultyType.NONE })
  difficultyType: DifficultyType;
  @Column({ type: 'varchar', length: 16, default: SubsidyStatus.DRAFT })
  status: SubsidyStatus;
  @Column({ type: 'simple-json', nullable: true })
  guardResults: { passed: boolean; label: string; ok: boolean; message: string }[];
  @Column({ type: 'text', nullable: true })
  reviewComment: string;
  @Column({ nullable: true })
  reviewedById: string;
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date;
  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date;
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 施工过程（材料/照片/阶段进度）----------
@Entity('construction_logs')
export class ConstructionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  stage: string; // 拆除加层/墙体加固/屋面修复/清退/警示安置/自检
  @Column({ type: 'text' })
  content: string;
  @Column({ nullable: true })
  materialName: string; // 实际使用材料
  @Column({ nullable: true })
  materialSpec: string; // 实际规格（与预算明细比对）
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
  @Column({ type: 'int', default: 0 })
  progressPercent: number;
  @Column({ default: false })
  materialVerified: boolean; // 材料与预算是否一致
  @Column({ type: 'timestamptz' })
  recordedAt: Date;
  @Column({ nullable: true })
  recorderId: string;
}

// ---------- 验收 ----------
@Entity('acceptances')
export class Acceptance {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  planId: string;
  @Column()
  inspectorId: string;
  @Column({ nullable: true })
  inspectorName: string;
  @Column({ type: 'timestamptz' })
  acceptedAt: Date;
  @Column({ type: 'varchar', length: 8 })
  overall: AcceptanceResult;
  @Column({ type: 'text', nullable: true })
  comment: string;
  @OneToMany(() => AcceptanceItemResult, (r) => r.acceptance, { cascade: true })
  itemResults: AcceptanceItemResult[];
}

@Entity('acceptance_item_results')
export class AcceptanceItemResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => Acceptance, (a) => a.itemResults, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'acceptanceId' })
  acceptance: Acceptance;
  @Column()
  acceptanceId: string;
  @Column()
  itemId: string;
  @Column({ type: 'varchar', length: 64 })
  itemType: string;
  @Column({ type: 'varchar', length: 8 })
  result: AcceptanceResult;
  @Column({ type: 'text', nullable: true })
  note: string;
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
}

// ---------- 销号 ----------
@Entity('close_records')
export class CloseRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  acceptanceId: string;
  @Column({ type: 'timestamptz' })
  closedAt: Date;
  @Column()
  closedById: string;
  @Column({ default: false })
  confirmedStopUseLifted: boolean; // 停用措施按方案解除/房屋安全恢复确认
  @Column({ default: false })
  confirmedAllItems: boolean; // 整改项逐条完成
  @Column({ type: 'text', nullable: true })
  remark: string;
  @Column({ default: false })
  invalidated: boolean; // 该次销号是否已被后续复查作废旧销号
  @Column({ type: 'timestamptz', nullable: true })
  invalidatedAt: Date;
  @Column({ type: 'text', nullable: true })
  invalidateReason: string;
}

// ---------- 复查 ----------
@Entity('recheck_records')
export class RecheckRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 8 })
  result: AcceptanceResult; // PASS 保持销号 / FAIL 问题反弹
  @Column({ type: 'text', nullable: true })
  reboundNotes: string;
  @Column({ type: 'int', nullable: true })
  wallCrack: number;
  @Column({ type: 'int', nullable: true })
  roofLeak: number;
  @Column({ type: 'int', nullable: true })
  foundationSettlement: number;
  @Column({ type: 'timestamptz' })
  checkedAt: Date;
  @Column()
  inspectorId: string;
  @Column({ default: false })
  sneakReturn: boolean; // 是否因人员擅自返回/偷返经营触发（接着原事件处理）
  @Column({ type: 'simple-json', nullable: true })
  sneakPersonIds: string[]; // 本次复查确认偷返的人员
  @Column({ type: 'simple-json', nullable: true })
  photos: string[]; // 复查现场照片
}

// ---------- 档案活动时间线 ----------
@Entity('house_activities')
export class HouseActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 32 })
  kind: string; // INSPECTION/REVIEW/NOTICE/EVACUATE/PLAN/SUBSIDY/MATERIAL/CONSTRUCTION/ACCEPTANCE/CLOSE/RECHECK/ISSUE/CONSULT
  @Column()
  title: string;
  @Column({ type: 'text', nullable: true })
  detail: string;
  @Column({ nullable: true })
  operatorId: string;
  @Column({ nullable: true })
  operatorName: string;
  @CreateDateColumn()
  createdAt: Date;
}
