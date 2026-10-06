<template>
  <div v-loading="loading">
    <el-alert
      title="治理口径：县级看到的不只是数量销号，更关注高风险房屋是否真正停用、整改是否按方案逐项完成、补助是否发给符合条件家庭。"
      type="info" show-icon :closable="false" style="margin-bottom:14px" />

    <el-row :gutter="14">
      <el-col :span="6"><div class="kpi"><div class="num">{{ d.totalHouses }}</div><div class="k">建档房屋总数</div></div></el-col>
      <el-col :span="6"><div class="kpi warn"><div class="num">{{ d.highRisk }}</div><div class="k">暂停使用+紧急转移（高风险）</div></div></el-col>
      <el-col :span="6"><div class="kpi danger"><div class="num">{{ Math.round((d.highRiskStopRate || 0) * 100) }}%</div><div class="k">高风险已停用/处置率（{{ d.highRiskStopped }}/{{ d.highRisk }}）</div></div></el-col>
      <el-col :span="6"><div class="kpi ok"><div class="num">{{ Math.round((d.closureRate || 0) * 100) }}%</div><div class="k">销号率（{{ d.closed }}/{{ d.totalHouses }}，反弹 {{ d.rebound }}）</div></div></el-col>
    </el-row>

    <el-alert
      v-if="d.notStoppedHouses?.length"
      :title="`高风险尚未真正停用（${d.notStoppedHouses.length}栋）——存在人员继续居住/经营风险，需立即督办`"
      type="error" show-icon :closable="false" style="margin:14px 0" />
    <el-table v-if="d.notStoppedHouses?.length" :data="d.notStoppedHouses" size="small" style="margin-bottom:14px" border>
      <el-table-column prop="code" label="档案号" width="150" />
      <el-table-column prop="township" label="乡镇" width="100" />
      <el-table-column prop="village" label="村" width="120" />
      <el-table-column prop="ownerName" label="户主" width="100" />
      <el-table-column label="风险" width="110">
        <template #default="{ row }"><el-tag size="small" :type="RISK[row.riskLevel].type">{{ RISK[row.riskLevel].label }}</el-tag></template>
      </el-table-column>
      <el-table-column label="当前状态">
        <template #default="{ row }"><el-tag size="small" :type="STATUS[row.status]?.type">{{ STATUS[row.status]?.label }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }"><el-button link type="primary" @click="$router.push(`/houses/${row.id}`)">进档案督办</el-button></template>
      </el-table-column>
    </el-table>

    <!-- 人员转移清退口径 -->
    <el-card shadow="never" style="margin-bottom:14px">
      <template #header>人员转移清退口径（逐人花名册现场核对，防止“数字清退”）</template>
      <el-row :gutter="12">
        <el-col :span="5"><div class="kpi"><div class="num">{{ d.evacuationSummary?.requiredHouses || 0 }}</div><div class="k">须紧急转移房屋</div></div></el-col>
        <el-col :span="5"><div class="kpi ok"><div class="num">{{ d.evacuationSummary?.clearedHouses || 0 }}</div><div class="k">全员清退房屋</div></div></el-col>
        <el-col :span="5"><div class="kpi danger"><div class="num">{{ d.evacuationSummary?.partialHouses || 0 }}</div><div class="k">未全员清退/未建花名册</div></div></el-col>
        <el-col :span="5"><div class="kpi"><div class="num">{{ d.evacuationSummary?.personsRelocated || 0 }}</div><div class="k">现场确认已离开（人）</div></div></el-col>
        <el-col :span="4"><div class="kpi danger"><div class="num">{{ (d.evacuationSummary?.personsStaying||0)+(d.evacuationSummary?.personsSneakBack||0) }}</div><div class="k">仍在+偷返（人）</div></div></el-col>
      </el-row>
      <el-alert
        v-if="partialRows.length"
        :title="`登记人数≠清退人数：以下 ${partialRows.length} 栋要求紧急转移但花名册未全员清退，系统已冻结其开工/验收/销号/拨付`"
        type="error" show-icon :closable="false" style="margin:12px 0 8px" />
      <el-table v-if="partialRows.length" :data="partialRows" size="small" border>
        <el-table-column prop="code" label="档案号" width="150" />
        <el-table-column prop="township" label="乡镇" width="100" />
        <el-table-column prop="village" label="村" width="120" />
        <el-table-column prop="ownerName" label="户主/经营者" width="120" />
        <el-table-column label="清退进度" width="180">
          <template #default="{ row }">
            <el-tag size="small" :type="row.registered ? 'danger' : 'info'">
              {{ row.registered ? `登记${row.registered}人·离开${row.relocated}人·未清${row.unresolved}人` : '未建立花名册' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }"><el-button link type="primary" @click="$router.push(`/houses/${row.id}`)">进花名册核对</el-button></template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-row :gutter="14">
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>风险等级分布</template>
          <div v-for="(v, k) in d.byRisk" :key="k" class="bar-row">
            <el-tag size="small" :type="RISK[k].type" class="bar-label">{{ RISK[k].label }}</el-tag>
            <el-progress :percentage="pct(v, d.totalHouses)" :stroke-width="16" :format="() => v + '栋'" />
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>治理环节分布</template>
          <div v-for="(v, k) in d.byStatus" :key="k" class="bar-row">
            <el-tag size="small" :type="(STATUS[k]||{}).type || 'info'" class="bar-label">{{ (STATUS[k]||{}).label || k }}</el-tag>
            <el-progress :percentage="pct(v, d.totalHouses)" :stroke-width="16" :status="k==='REBOUND'?'exception':k==='CLOSED'?'success':''" :format="() => v + '栋'" />
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>补助发放监督</template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="资格校验未过/补材料">{{ d.subsidySummary?.draft }}</el-descriptions-item>
            <el-descriptions-item label="待乡镇复核">{{ d.subsidySummary?.submitted }}</el-descriptions-item>
            <el-descriptions-item label="已批准（待销号后发）">{{ d.subsidySummary?.approved }}</el-descriptions-item>
            <el-descriptions-item label="已驳回">{{ d.subsidySummary?.rejected }}</el-descriptions-item>
            <el-descriptions-item label="已发放">{{ d.subsidySummary?.paid }} 户</el-descriptions-item>
            <el-descriptions-item label="累计发放金额"><b class="money">¥{{ (d.subsidySummary?.paidAmount || 0).toLocaleString() }}</b></el-descriptions-item>
            <el-descriptions-item label="安置补助 待核定/已核定">{{ (d.aidSummary?.applied||0) }} / {{ (d.aidSummary?.approved||0) }} 户</el-descriptions-item>
            <el-descriptions-item label="安置补助已拨付">{{ d.aidSummary?.paid || 0 }} 户 · ¥{{ (d.aidSummary?.paidAmount || 0).toLocaleString() }}</el-descriptions-item>
            <el-descriptions-item label="经营损失 申报/核定">{{ (d.businessSummary?.lossReported||0) }} / {{ (d.businessSummary?.lossVerified||0) }}</el-descriptions-item>
            <el-descriptions-item label="复营业 待核准/已核准">{{ (d.businessSummary?.resumptionApplied||0) }} / {{ (d.businessSummary?.resumptionApproved||0) }}</el-descriptions-item>
          </el-descriptions>
          <div class="section-hint">整改补助与安置补助均在有效销号后拨付；复营业须凭有效销号申请，销号作废则核准一并失效。</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top:14px">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>分乡镇治理进度</template>
          <el-table :data="townshipRows" size="small" border>
            <el-table-column prop="township" label="乡镇" />
            <el-table-column prop="total" label="建档" width="70" align="center" />
            <el-table-column prop="highRisk" label="高风险" width="80" align="center" />
            <el-table-column label="销号率" width="120">
              <template #default="{ row }">{{ row.total ? Math.round(row.closed / row.total * 100) : 0 }}%（{{ row.closed }}）</template>
            </el-table-column>
            <el-table-column label="反弹" width="70" align="center">
              <template #default="{ row }"><el-tag size="small" :type="row.rebound ? 'danger' : 'success'">{{ row.rebound }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>基层协商成本：异常事件处置（7类）</template>
          <el-table :data="issueRows" size="small" border>
            <el-table-column label="异常类型">
              <template #default="{ row }">{{ ISSUE_TYPES[row.k] }}</template>
            </el-table-column>
            <el-table-column label="未办结" width="90" align="center">
              <template #default="{ row }"><el-tag size="small" :type="row.open ? 'danger' : 'info'">{{ row.open }}</el-tag></template>
            </el-table-column>
            <el-table-column label="已办结" width="90" align="center">
              <template #default="{ row }">{{ row.resolved }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" style="margin-top:14px">
      <template #header>整改措施完成情况（按整改项）</template>
      <el-row :gutter="10">
        <el-col v-for="(v, k) in d.itemByType" :key="k" :span="8" style="margin-bottom:10px">
          <div class="bar-row">
            <span class="bar-text">{{ ITEM_TYPES[k] }}</span>
            <el-progress :percentage="v.total ? Math.round(v.done / v.total * 100) : 0" :stroke-width="14"
              :status="v.failed ? 'exception' : 'success'"
              :format="() => `${v.done}/${v.total}${v.failed ? ` 不合格${v.failed}` : ''}`" />
          </div>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import http from '../api';
import { RISK, STATUS, ISSUE_TYPES, ITEM_TYPES } from '../labels';

const d = ref({});
const loading = ref(false);
const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);
const townshipRows = computed(() => Object.entries(d.value.byTownship || {}).map(([township, v]) => ({ township, ...v })));
const issueRows = computed(() => Object.entries(d.value.issuesByType || {}).map(([k, v]) => ({ k, ...v })));
const partialRows = computed(() => d.value.evacuationSummary?.partialEvacHouses || []);

onMounted(async () => {
  loading.value = true;
  try {
    const { data } = await http.get('/api/dashboard');
    d.value = data;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.kpi { background:#fff; border-radius:10px; padding:18px 20px; border-left:5px solid #2f6fb3; }
.kpi.warn { border-color:#e6a23c; } .kpi.danger { border-color:#f56c6c; } .kpi.ok { border-color:#67c23a; }
.kpi .num { font-size:30px; font-weight:700; color:#1f2d3d; }
.kpi .k { color:#7a8899; font-size:13px; margin-top:4px; }
.bar-row { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.bar-label { width:78px; flex:none; text-align:center; }
.bar-text { width:110px; flex:none; font-size:13px; color:#445; }
.money { color:#f56c6c; }
</style>
