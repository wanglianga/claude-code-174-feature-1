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
      <div v-if="archive.close">
        <el-tag v-if="archive.close.revoked" type="danger">原销号已撤销 {{ fmtDate(archive.close.revokedAt) }}</el-tag>
        <el-tag v-else type="success">已销号 {{ fmtDate(archive.close.closedAt) }}</el-tag>
        <span style="margin-left:8px">{{ archive.close.revoked ? archive.close.revokeReason : archive.close.remark }}</span>
      </div>
      <el-alert v-if="auth.isCounty && archive.house?.status==='PENDING_ACCEPTANCE'" type="success" :closable="false" show-icon
        title="最新验收已通过，可由县级主管部门销号（销号后系统准许转移人员返回）" style="margin:8px 0" />
      <div v-if="auth.isCounty && archive.house?.status==='PENDING_ACCEPTANCE'">
        <el-checkbox v-model="closeForm.confirmedAllItems">已逐项确认整改方案全部按方案完成</el-checkbox><br/>
        <el-checkbox v-model="closeForm.confirmedStopUseLifted">已确认房屋安全恢复、停用/警示措施按方案处理、非“数字销号”</el-checkbox>
        <div><el-button type="success" style="margin-top:8px" @click="closeHouse">县级销号</el-button></div>
      </div>

      <el-divider v-if="archive.close">销号后复查（问题反弹自动重新纳入治理）</el-divider>
      <el-table v-if="archive.rechecks?.length" :data="archive.rechecks" size="small" border>
        <el-table-column label="复查时间" width="170"><template #default="{row}">{{ fmtDate(row.checkedAt) }}</template></el-table-column>
        <el-table-column label="环节" width="110">
          <template #default="{row}"><el-tag size="small" :type="row.phase==='POST_CLOSE'?'success':'warning'">{{ row.phase==='POST_CLOSE'?'销号后复查':'整改期核查' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="结论" width="110">
          <template #default="{row}"><el-tag size="small" :type="row.result==='PASS'?'success':'danger'">{{ row.result==='PASS'?'无异常/保持销号':'反弹/偷返续办' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="reboundNotes" label="情况" />
      </el-table>
      <div v-if="canRecheck && archive.close" style="margin-top:8px">
        <el-button size="small" type="success" @click="recheck('PASS')">复查通过</el-button>
        <el-button size="small" type="danger" @click="recheck('FAIL')">复查发现反弹</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { ITEM_TYPES, ITEM_STATUS, fmtDate } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const canAccept = ['ACCEPTOR', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canRecheck = ['GRID_WORKER', 'ACCEPTOR', 'COUNTY_ADMIN'].includes(auth.role);
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
</script>
