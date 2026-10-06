<template>
  <div>
    <el-card shadow="never">
      <template #header>验收记录（按整改项逐条确认）</template>
      <el-timeline>
        <el-timeline-item v-for="acc in archive.acceptances||[]" :key="acc.id" :timestamp="fmtDate(acc.acceptedAt)" placement="top">
          <el-tag :type="acc.overall==='PASS'?'success':'danger'">{{ acc.overall==='PASS'?'验收通过':'验收不通过' }}</el-tag>
          <span style="margin-left:8px">{{ acc.inspectorName }} · {{ acc.comment }}</span>
          <el-table :data="acc.itemResults" size="small" border style="margin-top:6px">
            <el-table-column label="整改项" width="170"><template #default="{row}">{{ ITEM_TYPES[row.itemType] || row.itemType }}</template></el-table-column>
            <el-table-column label="结论" width="90">
              <template #default="{row}"><el-tag size="small" :type="row.result==='PASS'?'success':'danger'">{{ row.result==='PASS'?'合格':'不合格' }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="note" label="说明" />
          </el-table>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-if="!archive.acceptances?.length" description="尚未组织验收" :image-size="60" />
    </el-card>

    <!-- 组织验收 -->
    <el-card v-if="canAccept && acceptItems.length" shadow="never" style="margin-top:12px">
      <template #header>组织验收（必改项须先完成施工；阻断性问题须办结）</template>
      <el-table :data="acceptForm" size="small" border>
        <el-table-column label="整改项" width="170"><template #default="{row}">{{ ITEM_TYPES[row.itemType] }}（施工：{{ ITEM_STATUS[row.itemStatus]?.label }}）</template></el-table-column>
        <el-table-column label="验收结论" width="220">
          <template #default="{row}">
            <el-radio-group v-model="row.result" size="small">
              <el-radio-button value="PASS">合格</el-radio-button>
              <el-radio-button value="FAIL">不合格</el-radio-button>
            </el-radio-group>
          </template>
        </el-table-column>
        <el-table-column label="备注"><template #default="{row}"><el-input v-model="row.note" size="small" /></template></el-table-column>
      </el-table>
      <el-input v-model="acceptComment" type="textarea" :rows="2" placeholder="验收总体意见" style="margin-top:8px" />
      <el-button type="primary" style="margin-top:8px" @click="submitAcceptance">提交逐条验收结论</el-button>
    </el-card>

    <!-- 销号 -->
    <el-card shadow="never" style="margin-top:12px">
      <template #header>销号与复查</template>
      <el-timeline v-if="archive.closes?.length">
        <el-timeline-item v-for="c in archive.closes" :key="c.id" :timestamp="fmtDate(c.closedAt)" placement="top">
          <el-tag :type="c.invalidated ? 'danger' : 'success'">{{ c.invalidated ? '该次销号已作废' : '有效销号' }}</el-tag>
          <span style="margin-left:8px">{{ c.remark }}</span>
          <div v-if="c.invalidated" class="sub">作废原因：{{ c.invalidateReason || '复查发现偷返/问题反弹' }}（{{ fmtDate(c.invalidatedAt) }}）</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-if="!archive.closes?.length" description="尚未销号" :image-size="50" />
      <el-alert v-if="auth.isCounty && archive.house?.status==='PENDING_ACCEPTANCE'" type="success" :closable="false" show-icon
        title="最新验收已通过，可由县级主管部门销号（花名册全员清退为前置；销号后系统准许转移人员返回）" style="margin:8px 0" />
      <div v-if="auth.isCounty && archive.house?.status==='PENDING_ACCEPTANCE'">
        <el-checkbox v-model="closeForm.confirmedAllItems">已逐项确认整改方案全部按方案完成</el-checkbox><br/>
        <el-checkbox v-model="closeForm.confirmedStopUseLifted">已确认房屋安全恢复、停用/警示措施按方案处理、非“数字销号”</el-checkbox>
        <div><el-button type="success" style="margin-top:8px" @click="closeHouse">县级销号</el-button></div>
      </div>

      <el-divider>复查（反弹自动重新纳入治理；偷返接着原事件处理并作废旧销号）</el-divider>
      <el-table v-if="archive.rechecks?.length" :data="archive.rechecks" size="small" border>
        <el-table-column label="复查时间" width="170"><template #default="{row}">{{ fmtDate(row.checkedAt) }}</template></el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{row}"><el-tag size="small" :type="row.sneakReturn ? 'danger' : 'warning'">{{ row.sneakReturn ? '偷返复查' : '常规复查' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="结论" width="100">
          <template #default="{row}"><el-tag size="small" :type="row.result==='PASS'?'success':'danger'">{{ row.result==='PASS'?'保持销号':'失效/重开' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="reboundNotes" label="情况" />
      </el-table>
      <div v-if="canRecheck" style="margin-top:8px">
        <el-button v-if="archive.close" size="small" type="success" @click="recheck('PASS')">常规复查通过</el-button>
        <el-button v-if="archive.close" size="small" type="danger" @click="recheck('FAIL')">常规复查发现反弹</el-button>
        <el-button size="small" type="danger" plain @click="openSneak">偷返复查（人员擅自返回/偷返经营）</el-button>
      </div>
    </el-card>

    <!-- 偷返复查弹窗：勾选人员+照片，接着原事件处理 -->
    <el-dialog v-model="showSneak" title="偷返复查：现场确认擅自返回/偷返经营人员" width="600px">
      <el-alert type="error" :closable="false" show-icon style="margin-bottom:10px"
        title="提交后：被勾选人员标记为“擅自返回”，当前若存在有效销号将被作废；后续处置接着本档案原事件进行，不新建记录。" />
      <el-checkbox-group v-model="sneakForm.personIds">
        <el-checkbox v-for="p in archive.evacPersons || []" :key="p.id" :value="p.id" style="display:block;margin:6px 0">
          {{ p.name }}（{{ PERSON_CATEGORY[p.category] || p.category }}）
          <el-tag size="small" style="margin-left:6px">{{ (PERSON_STATUS[p.evacStatus]||{}).label }}</el-tag>
        </el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!(archive.evacPersons||[]).length" description="花名册为空，请先建立并核对花名册" :image-size="50" />
      <el-form label-width="110px" style="margin-top:10px">
        <el-form-item label="现场情况">
          <el-input v-model="sneakForm.reboundNotes" type="textarea" :rows="2" placeholder="如：夜间复查发现店铺重新开张、人员搬回居住、现场有顾客" />
        </el-form-item>
        <el-form-item label="确认偷返经营"><el-switch v-model="sneakForm.operatingDetected" active-text="现场发现恢复经营" /></el-form-item>
        <el-form-item label="复查照片">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>sneakForm.photos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传复查照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in sneakForm.photos" :key="i" closable size="small" style="margin:4px 4px 0" @close="sneakForm.photos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSneak=false">取消</el-button>
        <el-button type="danger" @click="submitSneak">提交偷返复查</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { ITEM_TYPES, ITEM_STATUS, PERSON_CATEGORY, PERSON_STATUS, fmtDate } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const canAccept = ['ACCEPTOR', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canRecheck = ['GRID_WORKER', 'ACCEPTOR', 'COUNTY_ADMIN'].includes(auth.role);
const uploadUrl = '/api/upload';
const headers = computed(() => ({ Authorization: `Bearer ${localStorage.getItem('rhs_token')}` }));
const acceptComment = ref('');
const closeForm = reactive({ confirmedAllItems: false, confirmedStopUseLifted: false });
const acceptForm = ref([]);

const acceptItems = computed(() => props.archive.plans?.[0]?.items?.filter((i) => i.required) || []);
function syncAccept() {
  acceptForm.value = acceptItems.value.map((it) => ({
    itemId: it.id, itemType: it.type, itemStatus: it.status, result: it.status === 'FAILED' ? 'FAIL' : 'PASS', note: '',
  }));
}
watch(acceptItems, syncAccept, { immediate: true });

async function submitAcceptance() {
  await http.post('/api/acceptances', {
    houseId: props.archive.house.id,
    comment: acceptComment.value,
    itemResults: acceptForm.value,
  });
  ElMessage.success('验收结论已提交');
  emit('reload');
}
async function closeHouse() {
  if (!closeForm.confirmedAllItems || !closeForm.confirmedStopUseLifted) return ElMessage.warning('请勾选两项确认');
  await http.post('/api/closes', { houseId: props.archive.house.id, ...closeForm });
  ElMessage.success('已销号，转移人员可安全返回');
  emit('reload');
}
async function recheck(result) {
  let reboundNotes = '';
  const payload = { houseId: props.archive.house.id, result };
  if (result === 'FAIL') {
    const { value } = await ElMessageBox.prompt('描述反弹情况', '复查反弹', { inputType: 'textarea' });
    reboundNotes = value;
    Object.assign(payload, { reboundNotes, wallCrack: 2 });
  }
  await http.post('/api/rechecks', payload);
  ElMessage.success(result === 'PASS' ? '复查通过' : '已重新纳入治理流程');
  emit('reload');
}

const showSneak = ref(false);
const sneakForm = reactive({ personIds: [], reboundNotes: '', operatingDetected: true, photos: [] });
function openSneak() {
  Object.assign(sneakForm, { personIds: [], reboundNotes: '', operatingDetected: true, photos: [] });
  showSneak.value = true;
}
async function submitSneak() {
  if (!sneakForm.personIds.length) return ElMessage.warning('请勾选现场确认擅自返回的人员');
  await http.post('/api/rechecks', {
    houseId: props.archive.house.id,
    result: 'FAIL',
    sneakReturn: true,
    personIds: sneakForm.personIds,
    operatingDetected: sneakForm.operatingDetected,
    reboundNotes: sneakForm.reboundNotes,
    photos: sneakForm.photos,
  });
  ElMessage.success('偷返复查已提交：原事件重新处置，有效销号已作废');
  showSneak.value = false;
  emit('reload');
}
</script>
<style scoped>
.sub { color:#8a97a6; font-size:12px; }
</style>
