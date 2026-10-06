<template>
  <div>
    <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px"
      title="人员转移全部落实后，乡镇继续处理：过渡期安置补助、停业经营损失、以及何时允许恢复营业。安置补助与整改补助一样，核定可以保留，但拨付必须停在有效销号之后；复营业必须凭有效销号另行申请核准。" />

    <el-row :gutter="12">
      <!-- 安置补助 -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>过渡期安置补助（50元/人天，每户≤2万）</template>
          <div v-if="archive.aid">
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="核补人天">{{ archive.aid.personDays }} 人天</el-descriptions-item>
              <el-descriptions-item label="核定金额"><b class="money">¥{{ Number(archive.aid.amount).toLocaleString() }}</b></el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag size="small" :type="(AID_STATUS[archive.aid.status]||{}).type">{{ (AID_STATUS[archive.aid.status]||{}).label }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="核定意见">{{ archive.aid.reviewComment || '—' }}</el-descriptions-item>
            </el-descriptions>
          </div>
          <el-empty v-else description="尚未申请安置补助" :image-size="60" />

          <div v-if="canApply" style="margin-top:10px">
            <el-input-number v-model="personDays" :min="1" :step="1" /> 人天
            <span class="sub">（参考 50 元/人天，封顶 2 万，系统自动核定金额）</span>
            <div><el-button size="small" type="primary" style="margin-top:8px" @click="submitAid">提交/重新核算安置补助</el-button></div>
          </div>
          <div v-if="canReview && archive.aid?.status === 'APPLIED'" style="margin-top:8px">
            <el-input v-model="aidComment" size="small" placeholder="核定意见" />
            <el-button size="small" type="success" style="margin-top:6px" @click="reviewAid(true)">核定通过</el-button>
            <el-button size="small" type="danger" @click="reviewAid(false)">不予核定</el-button>
          </div>
          <div v-if="auth.isCounty && archive.aid?.status === 'APPROVED'" style="margin-top:8px">
            <el-button size="small" type="warning" @click="payAid">有效销号后拨付</el-button>
            <span class="sub">未销号或销号已作废时拨付会被拒绝</span>
          </div>
        </el-card>
      </el-col>

      <!-- 经营损失 -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>停业经营损失登记与核定</template>
          <el-table v-if="archive.businessLosses?.length" :data="archive.businessLosses" size="small" border>
            <el-table-column prop="businessName" label="经营字号" width="130" />
            <el-table-column label="停业天数" width="80"><template #default="{row}">{{ row.closedDays }}天</template></el-table-column>
            <el-table-column label="申报" width="100"><template #default="{row}">¥{{row.claimedAmount}}</template></el-table-column>
            <el-table-column label="核定" width="100"><template #default="{row}">¥{{row.verifiedAmount}}</template></el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="(LOSS_STATUS[row.status]||{}).type">{{ (LOSS_STATUS[row.status]||{}).label }}</el-tag></template>
            </el-table-column>
            <el-table-column label="核定" width="80">
              <template #default="{row}">
                <el-button v-if="canReview && row.status !== 'VERIFIED'" link type="primary" size="small" @click="openLoss(row)">核定</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="尚未申报经营损失" :image-size="60" />
          <el-button v-if="canApply && archive.house?.isBusiness" size="small" type="primary" plain style="margin-top:8px" @click="openLoss(null)">
            申报停业经营损失
          </el-button>
        </el-card>
      </el-col>
    </el-row>

    <!-- 复营业核准 -->
    <el-card shadow="never" style="margin-top:12px">
      <template #header>复营业核准（何时允许恢复营业）</template>
      <el-timeline v-if="archive.resumptions?.length">
        <el-timeline-item v-for="r in archive.resumptions" :key="r.id" :timestamp="fmtDate(r.appliedAt)" placement="top">
          <el-tag :type="(RESUMPTION_STATUS[r.status]||{}).type">{{ (RESUMPTION_STATUS[r.status]||{}).label }}</el-tag>
          <b style="margin-left:8px">{{ r.businessName }}</b>
          <span v-if="r.resumeFrom" class="sub"> · 核准自 {{ r.resumeFrom }} 起恢复营业</span>
          <div class="sub">申请：{{ r.applicantName }}；{{ r.applyReason }}</div>
          <div v-if="r.reviewComment" class="sub">核准意见：{{ r.reviewComment }}</div>
          <div v-if="canReview && r.status === 'APPLIED'" style="margin-top:6px">
            <el-date-picker v-model="resumeFrom" type="date" value-format="YYYY-MM-DD" size="small" placeholder="核准恢复营业起始日" />
            <el-button size="small" type="success" @click="reviewResumption(r,true)">核准复营业</el-button>
            <el-button size="small" type="danger" @click="reviewResumption(r,false)">不予核准</el-button>
          </div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="尚未申请复营业（须有效销号后方可申请）" :image-size="60" />
      <el-button v-if="canApply && archive.house?.isBusiness" size="small" type="primary" plain style="margin-top:8px" @click="openResumption">
        申请恢复营业
      </el-button>
    </el-card>

    <!-- 经营损失申报弹窗 -->
    <el-dialog v-model="showLoss" :title="lossForm.id ? '核定经营损失' : '申报停业经营损失'" width="520px">
      <el-form label-width="110px">
        <el-form-item label="经营字号/业态"><el-input v-model="lossForm.businessName" :disabled="!!lossForm.id" /></el-form-item>
        <el-form-item label="经营者"><el-input v-model="lossForm.operatorName" :disabled="!!lossForm.id" /></el-form-item>
        <el-form-item label="月均营业额"><el-input-number v-model="lossForm.monthlyRevenue" :min="0" :disabled="!!lossForm.id" /></el-form-item>
        <el-form-item label="停业天数"><el-input-number v-model="lossForm.closedDays" :min="0" :disabled="!!lossForm.id" /></el-form-item>
        <el-form-item label="申报损失金额"><el-input-number v-model="lossForm.claimedAmount" :min="0" :disabled="!!lossForm.id" /></el-form-item>
        <template v-if="lossForm.id">
          <el-form-item label="核定金额"><el-input-number v-model="lossForm.verifiedAmount" :min="0" /></el-form-item>
          <el-form-item label="核定意见"><el-input v-model="lossForm.comment" type="textarea" :rows="2" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="showLoss=false">取消</el-button>
        <el-button v-if="!lossForm.id" type="primary" @click="submitLoss">提交申报</el-button>
        <el-button v-else type="success" @click="submitLossReview(true)">核定通过</el-button>
      </template>
    </el-dialog>

    <!-- 复营业申请弹窗 -->
    <el-dialog v-model="showResumption" title="申请恢复营业" width="480px">
      <el-form label-width="100px">
        <el-form-item label="经营字号"><el-input v-model="resumptionForm.businessName" /></el-form-item>
        <el-form-item label="申请人"><el-input v-model="resumptionForm.applicantName" /></el-form-item>
        <el-form-item label="申请说明"><el-input v-model="resumptionForm.applyReason" type="textarea" :rows="3" placeholder="整改完成情况、安全自查情况" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showResumption=false">取消</el-button>
        <el-button type="primary" @click="submitResumption">提交复营业申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { AID_STATUS, LOSS_STATUS, RESUMPTION_STATUS, fmtDate } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const canApply = computed(() => ['FARMER', 'GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role));
const canReview = computed(() => ['TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role));

const personDays = ref(30);
const aidComment = ref('');
async function submitAid() {
  await http.post(`/api/houses/${props.archive.house.id}/aids`, { personDays: personDays.value });
  ElMessage.success('安置补助已提交核算');
  emit('reload');
}
async function reviewAid(approved) {
  await http.post(`/api/aids/${props.archive.aid.id}/review`, { approved, comment: aidComment.value });
  ElMessage.success(approved ? '已核定（销号后拨付）' : '已不予核定');
  emit('reload');
}
async function payAid() {
  await ElMessageBox.confirm('确认房屋已有效销号、拨付过渡期安置补助？', '资金拨付', { type: 'warning' });
  await http.post(`/api/aids/${props.archive.aid.id}/pay`, {});
  ElMessage.success('安置补助已拨付');
  emit('reload');
}

const showLoss = ref(false);
const lossForm = reactive({ id: '', businessName: '', operatorName: '', monthlyRevenue: 0, closedDays: 0, claimedAmount: 0, verifiedAmount: 0, comment: '' });
function openLoss(row) {
  if (row) Object.assign(lossForm, { id: row.id, businessName: row.businessName, operatorName: row.operatorName, monthlyRevenue: Number(row.monthlyRevenue), closedDays: row.closedDays, claimedAmount: Number(row.claimedAmount), verifiedAmount: Number(row.claimedAmount), comment: '' });
  else Object.assign(lossForm, { id: '', businessName: '', operatorName: props.archive.house?.ownerName || '', monthlyRevenue: 0, closedDays: 0, claimedAmount: 0, verifiedAmount: 0, comment: '' });
  showLoss.value = true;
}
async function submitLoss() {
  await http.post(`/api/houses/${props.archive.house.id}/business-losses`, { ...lossForm });
  ElMessage.success('经营损失已申报，待乡镇核定');
  showLoss.value = false;
  emit('reload');
}
async function submitLossReview(approved) {
  await http.post(`/api/business-losses/${lossForm.id}/review`, { approved, verifiedAmount: lossForm.verifiedAmount, comment: lossForm.comment });
  ElMessage.success('已核定');
  showLoss.value = false;
  emit('reload');
}

const showResumption = ref(false);
const resumptionForm = reactive({ businessName: '', applicantName: '', applyReason: '' });
const resumeFrom = ref('');
function openResumption() {
  Object.assign(resumptionForm, { businessName: props.archive.house?.usage || '', applicantName: auth.user?.name || '', applyReason: '' });
  showResumption.value = true;
}
async function submitResumption() {
  await http.post(`/api/houses/${props.archive.house.id}/resumptions`, { ...resumptionForm });
  ElMessage.success('复营业申请已提交，待乡镇核准');
  showResumption.value = false;
  emit('reload');
}
async function reviewResumption(r, approved) {
  if (approved && !resumeFrom.value) return ElMessage.warning('请选择核准恢复营业的起始日期');
  await http.post(`/api/resumptions/${r.id}/review`, { approved, resumeFrom: resumeFrom.value, comment: approved ? '同意恢复营业' : '暂不具备恢复营业条件' });
  ElMessage.success(approved ? '已核准复营业' : '已不予核准');
  resumeFrom.value = '';
  emit('reload');
}
</script>
<style scoped>.money{color:#f56c6c;font-weight:700}.sub{color:#8a97a6;font-size:12px}</style>
