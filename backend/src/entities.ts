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
  EVACUATING = 'EVACUATING', // 转移中（清册已登记但未全员确认离开，不得清退）
  EVACUATED = 'EVACUATED', // 已转移（全员清退）
  RECTIFYING = 'RECTIFYING', // 整改中
  PENDING_ACCEPTANCE = 'PENDING_ACCEPTANCE', // 待验收
  ACCEPTANCE_FAILED = 'ACCEPTANCE_FAILED', // 验收不通过
  CLOSED = 'CLOSED', // 已销号
  REBOUND = 'REBOUND', // 复查反弹/重新治理
  REFUSED = 'REFUSED', // 农户拒绝整改
}

// 转移清册现场核对后的整体清退状态
export enum EvacuationState {
  NONE = 'NONE', // 未建立转移清册
  PARTIAL = 'PARTIAL', // 登记N人，确认离开M<N（含仍在现场继续经营/居住）
  FULL = 'FULL', // 全员已离开并安置
  RETURNED = 'RETURNED', // 整改期间有人擅自返回
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
  PERSON_RETURN = 'PERSON_RETURN', // 整改期间人员擅自返回/偷偷继续经营
  EVACUATION_INCOMPLETE = 'EVACUATION_INCOMPLETE', // 人员未全部清退（登记人数与现场核对不符）
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

// ---------- 转移人员清册：单人状态 ----------
export enum PersonMoveStatus {
  REGISTERED = 'REGISTERED', // 已登记应转移，现场尚未确认离开
  RESETTLED = 'RESETTLED', // 现场确认已离开并入住安置点
  STILL_ON_SITE = 'STILL_ON_SITE', // 现场核对：仍在房屋内（继续居住/经营）
  RETURNED = 'RETURNED', // 整改期间擅自返回
}

export enum PersonRole {
  OWNER = 'OWNER', // 户主/家庭成员
  RESIDENT = 'RESIDENT', // 常住人员
  TENANT = 'TENANT', // 租户
  OPERATOR = 'OPERATOR', // 经营者
  EMPLOYEE = 'EMPLOYEE', // 经营从业人员
}

// ---------- 安置补助/经营损失：类型与状态 ----------
export enum AllowanceType {
  RESETTLEMENT = 'RESETTLEMENT', // 安置补助（按人天/户）
  BUSINESS_LOSS = 'BUSINESS_LOSS', // 经营损失补偿
}

export enum AllowanceStatus {
  APPLIED = 'APPLIED', // 已申请，保留待审
  APPROVED = 'APPROVED', // 乡镇核定通过（仍须销号后拨付）
  REJECTED = 'REJECTED',
  PAID = 'PAID', // 已拨付
}

export enum AcceptanceResult {
  PASS = 'PASS',
  FAIL = 'FAIL',
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

  @Column({ type: 'varchar', length: 16, default: RiskLevel.NORMAL })
  riskLevel: RiskLevel;
  @Column({ type: 'varchar', length: 32, default: HouseStatus.PENDING_REVIEW })
  status: HouseStatus;
  @Column({ type: 'simple-json', nullable: true })
  ruleReasons: string[]; // 最新风险判定依据
  @Column({ default: false })
  stopUseConfirmed: boolean; // 是否已确认停用（封停/警示核查）
  @Column({ default: false })
  fullEvacuationConfirmed: boolean; // 转移清册全员是否已现场确认离开（部分确认时为false，不得清退）
  @Column({ default: false })
  businessClosed: boolean; // 经营场所是否已停止营业
  @Column({ default: false })
  resumeBusinessApproved: boolean; // 是否经乡镇/县级准许复营业
  @Column({ type: 'timestamptz', nullable: true })
  resumeBusinessAt: Date; // 准许复营业时间
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
  residents: number; // 实际转移人数
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
  @Column({ default: false })
  revoked: boolean; // 销号是否被撤销（整改期间/销号后复查发现反弹，旧销号失效）
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date;
  @Column({ nullable: true })
  revokedById: string;
  @Column({ type: 'text', nullable: true })
  revokeReason: string;
  @Column({ type: 'text', nullable: true })
  remark: string;
}

// ---------- 复查 ----------
@Entity('recheck_records')
export class RecheckRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 24, default: 'POST_CLOSE' })
  phase: string; // POST_CLOSE 销号后复查 / DURING_RECTIFICATION 整改期间现场核查（同一事件续办）
  @Column({ type: 'varchar', length: 8 })
  result: AcceptanceResult; // PASS 保持销号/现场无异常 / FAIL 问题反弹或发现偷返经营
  @Column({ type: 'text', nullable: true })
  reboundNotes: string;
  @Column({ type: 'simple-json', nullable: true })
  photos: string[]; // 现场核查照片
  @Column({ type: 'int', nullable: true })
  foundOnSite: number; // 现场发现仍在房屋内的人数
  @Column({ default: false })
  foundOperating: boolean; // 现场是否发现仍在/擅自恢复经营
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
  @Column({ nullable: true })
  inspectorName: string;
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

// ---------- 安置点 ----------
@Entity('shelters')
export class Shelter {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  name: string; // 安置点名称（溪口村部安置点等）
  @Column({ nullable: true })
  township: string; // 所属乡镇
  @Column({ nullable: true })
  address: string;
  @Column({ nullable: true })
  contact: string; // 联系人
  @Column({ nullable: true })
  phone: string;
  @Column({ type: 'int', default: 0 })
  capacity: number; // 可容纳人数
}

// ---------- 转移人员清册（一人一行，网格员现场核对）----------
@Entity('evacuation_persons')
export class EvacuationPerson {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  name: string;
  @Column({ nullable: true })
  phone: string;
  @Column({ type: 'varchar', length: 16, default: PersonRole.RESIDENT })
  role: PersonRole; // 户主/常住/租户/经营者/从业人员
  @Column({ type: 'varchar', length: 16, default: PersonMoveStatus.REGISTERED })
  moveStatus: PersonMoveStatus;
  @Column({ nullable: true })
  shelterId: string; // 实际入住安置点
  @Column({ nullable: true })
  shelterName: string; // 安置点名称快照（含投亲靠友等自找去向）
  @Column({ type: 'date', nullable: true })
  settledFrom: string; // 从哪天开始安置
  @Column({ type: 'date', nullable: true })
  settledTo: string; // 安置结束日期（销号准许返回/复营业后填写）
  @Column({ default: false })
  continueBusiness: boolean; // 现场核对：是否仍在继续经营
  @Column({ type: 'simple-json', nullable: true })
  photos: string[]; // 现场核对照片（人+安置点/封停现场）
  @Column({ type: 'text', nullable: true })
  remark: string;
  @Column({ type: 'timestamptz' })
  registeredAt: Date; // 建档登记时间
  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date; // 网格员最近一次现场核对时间
  @Column({ nullable: true })
  verifiedById: string;
  @Column({ nullable: true })
  verifiedByName: string;
  @Column({ type: 'timestamptz', nullable: true })
  returnedAt: Date; // 擅自返回时间
  @Column({ type: 'timestamptz', nullable: true })
  safeReturnedAt: Date; // 销号后准许安全返回时间
}

// ---------- 安置补助 / 经营损失补偿 ----------
@Entity('allowance_records')
export class AllowanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 24 })
  type: AllowanceType;
  @Column({ nullable: true })
  personId: string; // 安置补助可关联清册人员；经营损失可关联经营者
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount: string; // 申请金额
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  approvedAmount: string; // 乡镇核定金额
  @Column({ type: 'text', nullable: true })
  basis: string; // 核算依据（人天×标准 / 停业天数×日损失等）
  @Column({ type: 'simple-json', nullable: true })
  proof: string[]; // 佐证材料
  @Column({ type: 'varchar', length: 16, default: AllowanceStatus.APPLIED })
  status: AllowanceStatus;
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
