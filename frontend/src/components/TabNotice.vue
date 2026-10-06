<template>
  <div>
    <el-row :gutter="12">
      <el-col :span="12">
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
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>人员转移与临时安置</template>
          <el-alert v-if="rollup.registered" :type="rollup.cleared ? 'success' : 'error'" :closable="false" show-icon style="margin-bottom:8px"
            :title="rollup.cleared
              ? `花名册 ${rollup.registered} 人已全部确认离开并安置（已清退）`
              : `花名册 ${rollup.registered} 人，仅确认 ${rollup.relocated} 人离开（仍在 ${rollup.staying}、偷返 ${rollup.sneakBack}）——未清退`" />
          <el-button type="primary" size="small" style="margin-bottom:8px" @click="$emit('navigate','evac')">
            打开人员转移花名册逐人核对（安置点/起始日/照片）→
          </el-button>
          <div v-for="e in archive.evacuations||[]" :key="e.id" class="ev">
            <el-tag type="danger">本批转移{{ e.residents }}人</el-tag> → {{ e.destination }}
            <el-tag size="small" :type="e.allowReturn?'success':'warning'" style="margin-left:6px">{{ e.allowReturn?'已准许返回':'未准许返回' }}</el-tag>
            <div class="sub">{{ fmtDate(e.settledAt) }} 安置；{{ e.remark }}</div>
          </div>
          <el-empty v-if="!archive.evacuations?.length" description="暂无批次转移记录" :image-size="60" />
          <el-tag v-if="archive.house?.stopUseConfirmed" type="danger" effect="plain">房屋已确认封停/暂停使用</el-tag>
        </el-card>
      </el-col>
    </el-row>

    <el-card v-if="canOperate && latestPlan" shadow="never" class="form-card">
      <template #header>现场处置：风险告知 / 停用确认 / 转移登记（环节互相制约）</template>
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
        <el-divider>紧急转移登记</el-divider>
        <el-form-item label="转移人数"><el-input-number v-model="evac.residents" :min="0" /></el-form-item>
        <el-form-item label="安置去向">
          <el-select v-model="evac.destination" allow-create filterable style="width:280px">
            <el-option label="投亲靠友" value="投亲靠友" />
            <el-option label="村级安置点" value="村级安置点" />
            <el-option label="乡镇集中安置点" value="乡镇集中安置点" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="evac.remark" /></el-form-item>
        <el-form-item>
          <el-button type="danger" @click="doEvac">登记人员转移批次</el-button>
          <span class="hint">批次人数不等于全员清退；须到“人员转移花名册”逐人现场核对（安置点、起始日、照片），全员离开才算已清退，否则开工/验收/销号/拨付一律拦截。</span>
        </el-form-item>
      </el-form>
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
const rollup = computed(() => props.archive.evacRollup || { registered: 0, relocated: 0, staying: 0, sneakBack: 0, returned: 0, cleared: false });

const notice = reactive({ method: '现场告知', notifiedTo: [], acknowledged: true, content: '' });
const evac = reactive({ residents: props.archive.house?.residents || 0, destination: '村级安置点', remark: '' });

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
async function doEvac() {
  await http.post('/api/evacuations', { houseId: props.archive.house.id, ...evac });
  ElMessage.success('转移安置已登记');
  emit('reload');
}
</script>
<style scoped>
.sub { color:#7a8899; font-size:12.5px; margin:4px 0; }
.ev { padding:8px 0; border-bottom:1px dashed #e3e8ef; }
.form-card { margin-top:14px; }
.hint { color:#909caa; font-size:12px; margin-left:8px; }
</style>
