<template>
  <div>
    <el-card shadow="never">
      <template #header>风险告知记录</template>
      <el-timeline v-if="archive.notices?.length">
        <el-timeline-item v-for="n in archive.notices" :key="n.id" :timestamp="fmtDate(n.notifiedAt)" placement="top">
          <div><b>{{ n.method }}</b>
            <el-tag size="small" :type="n.acknowledged?'success':'danger'" style="margin-left:6px">{{ n.acknowledged?'已签收':'未签收' }}</el-tag>
          </div>
          <div class="sub">被告知：{{ n.notifiedTo.join('、') }}</div>
          <div class="sub">{{ n.content }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="尚未告知" :image-size="60" />
    </el-card>

    <el-card v-if="canOperate && latestPlan" shadow="never" class="form-card">
      <template #header>现场处置：风险告知 / 停用确认（人员转移清册请到“人员转移 · 复营业”页签逐人核对）</template>
      <el-descriptions :column="1" size="small" border style="margin-bottom:12px">
        <el-descriptions-item label="方案要求">
          <el-tag size="small" :type="latestPlan.stopUseRequired?'danger':'info'">暂停使用：{{ latestPlan.stopUseRequired?'是':'否' }}</el-tag>
          <el-tag size="small" :type="latestPlan.evacuationRequired?'danger':'info'" style="margin-left:6px">紧急转移：{{ latestPlan.evacuationRequired?'是':'否' }}</el-tag>
        </el-descriptions-item>
      </el-descriptions>
      <el-form label-width="110px">
        <el-form-item label="告知方式">
          <el-select v-model="notice.method" style="width:200px">
            <el-option label="现场告知" value="现场告知" /><el-option label="书面送达" value="书面送达" /><el-option label="电话告知" value="电话告知" />
          </el-select>
        </el-form-item>
        <el-form-item label="被告知对象">
          <el-select v-model="notice.notifiedTo" multiple filterable allow-create default-first-option placeholder="户主/租户/经营者" style="width:360px">
            <el-option label="户主（{{ archive.house?.ownerName }}）" :value="`户主（${archive.house?.ownerName}）`" />
            <el-option label="租户" value="租户" /><el-option label="经营者" value="经营者" />
          </el-select>
        </el-form-item>
        <el-form-item label="已签收确认"><el-switch v-model="notice.acknowledged" /></el-form-item>
        <el-form-item label="告知内容"><el-input v-model="notice.content" type="textarea" :rows="2" /></el-form-item>
        <el-form-item>
          <el-button type="primary" @click="sendNotice">登记风险告知</el-button>
          <el-button type="danger" plain @click="stopUse">确认房屋已封停/停用</el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="archive.house?.stopUseConfirmed" type="error" :closable="false" show-icon
        title="房屋已确认封停/暂停使用" style="margin-top:6px" />
    </el-card>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { fmtDate } from '../labels';
import { useAuthStore } from '../store';
const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const canOperate = ['GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const latestPlan = computed(() => props.archive.plans?.[0]);

const notice = reactive({ method: '现场告知', notifiedTo: [], acknowledged: true, content: '' });

async function sendNotice() {
  if (!notice.notifiedTo.length) return ElMessage.warning('请选择被告知对象');
  await http.post('/api/notices', { houseId: props.archive.house.id, ...notice });
  ElMessage.success('风险告知已登记');
  emit('reload');
}
async function stopUse() {
  await ElMessageBox.confirm('确认现场已拉警戒线/封停、人员已停止使用？', '停用确认', { type: 'warning' });
  await http.post(`/api/houses/${props.archive.house.id}/stop-use`, { confirmed: true });
  ElMessage.success('停用已确认');
  emit('reload');
}
</script>
<style scoped>
.sub { color:#7a8899; font-size:12.5px; margin:4px 0; }
.form-card { margin-top:14px; }
</style>
