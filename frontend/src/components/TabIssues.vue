<template>
  <div>
    <el-alert title="基层治理协商成本：户主、租户、经营者、老人家庭成员、村干部、施工队都会影响进度。系统把各方态度、协商结果与异常事件沉淀在档案中，阻断性问题办结前冻结对应环节。"
      type="info" :closable="false" show-icon style="margin-bottom:12px" />

    <el-row :gutter="12">
      <el-col :span="11">
        <el-card shadow="never">
          <template #header>利益相关方态度台账</template>
          <el-table :data="archive.stakeholders" size="small" border>
            <el-table-column label="身份" width="110">
              <template #default="{ row }"><el-tag size="small">{{ STAKEHOLDER_TYPES[row.type] }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="name" label="姓名" width="110" />
            <el-table-column label="态度" width="90">
              <template #default="{ row }"><el-tag size="small" :type="STANCES[row.stance]?.type">{{ STANCES[row.stance]?.label }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="influenceNote" label="对进度的影响" min-width="180" />
          </el-table>
          <el-button v-if="canStaff" size="small" style="margin-top:8px" @click="addStakeholder">登记相关方态度</el-button>
        </el-card>
      </el-col>
      <el-col :span="13">
        <el-card shadow="never">
          <template #header>协商记录</template>
          <el-timeline>
            <el-timeline-item v-for="c in archive.consultations" :key="c.id" :timestamp="fmtDate(c.heldAt)" placement="top">
              <b>{{ c.topic }}</b>
              <div class="sub">{{ c.outcome }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-button v-if="canStaff" size="small" type="primary" plain @click="addConsultation">新增协商记录</el-button>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" style="margin-top:12px">
      <template #header>异常事件（9类）</template>
      <el-table :data="archive.issues" size="small" border>
        <el-table-column label="类型" width="140">
          <template #default="{ row }">
            {{ ISSUE_TYPES[row.type] }}
            <el-icon v-if="row.blocksWorkflow && row.status!=='RESOLVED'" color="#f56c6c"><Warning /></el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="情况" min-width="220" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag size="small" :type="ISSUE_STATUS[row.status].type">{{ ISSUE_STATUS[row.status].label }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="raisedByName" label="上报人" width="110" />
        <el-table-column prop="resolution" label="处置结果" min-width="160" />
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <template v-if="row.status!=='RESOLVED' && canStaff">
              <el-button v-if="row.status==='OPEN'" link size="small" @click="resolve(row, 'RESOLVING')">处理中</el-button>
              <el-button link type="success" size="small" @click="resolve(row, 'RESOLVED')">办结</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <el-button v-if="canStaff" size="small" type="danger" plain style="margin-top:8px" @click="raise">上报异常</el-button>
    </el-card>
  </div>
</template>

<script setup>
import { reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { ISSUE_TYPES, ISSUE_STATUS, STAKEHOLDER_TYPES, STANCES, fmtDate } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const canStaff = ['GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);

async function addStakeholder() {
  const { value } = await ElMessageBox.prompt('格式：身份|姓名|态度(SUPPORT/NEUTRAL/OPPOSE)|影响说明，如 租户|陈伟|OPPOSE|租期未到', '登记相关方', { inputType: 'textarea' });
  const [type, name, stance, note] = value.split('|');
  await http.post(`/api/houses/${props.archive.house.id}/stakeholders`, { type, name, stance: stance || 'UNKNOWN', influenceNote: note || '' });
  ElMessage.success('已登记');
  emit('reload');
}
async function addConsultation() {
  const { value } = await ElMessageBox.prompt('格式：议题|协商结果', '新增协商', { inputType: 'textarea' });
  const [topic, outcome] = value.split('|');
  await http.post('/api/consultations', { houseId: props.archive.house.id, topic, outcome });
  ElMessage.success('协商记录已保存');
  emit('reload');
}
async function raise() {
  const { value: type } = await ElMessageBox.prompt('选择异常类型', '上报异常', {
    inputType: 'textarea',
    inputPlaceholder: Object.entries(ISSUE_TYPES).map(([k, v]) => `${k}=${v}`).join('\n'),
  });
  const { value: description } = await ElMessageBox.prompt('描述具体情况', '上报异常', { inputType: 'textarea' });
  await http.post('/api/issues', { houseId: props.archive.house.id, type: type.trim(), description });
  ElMessage.success('异常已上报，阻断性问题将冻结后续环节');
  emit('reload');
}
async function resolve(row, status) {
  let resolution = '';
  if (status === 'RESOLVED') {
    const r = await ElMessageBox.prompt('必须填写处置结果', '办结异常', { inputType: 'textarea' });
    resolution = r.value;
  }
  await http.post(`/api/issues/${row.id}/status`, { status, resolution });
  ElMessage.success('状态已更新');
  emit('reload');
}
</script>
<style scoped>.sub { color:#6b7888; font-size:12.5px; margin-top:3px; }</style>
