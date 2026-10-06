<template>
  <div>
    <!-- 清退口径总览 -->
    <el-card shadow="never" :class="{ 'card-gate': !cleared }">
      <template #header>
        <div class="hd">
          人员转移清退口径（网格员现场逐人核对）
          <el-tag :type="cleared ? 'success' : 'danger'" effect="dark" style="margin-left:10px">
            {{ cleared ? '已全员清退' : '未清退（不得开工/验收/销号/拨付）' }}
          </el-tag>
          <el-tag v-if="rollup.stillOperating" type="warning" effect="dark" style="margin-left:8px">仍有人继续经营</el-tag>
        </div>
      </template>
      <el-row :gutter="10">
        <el-col :span="5"><div class="kpi"><div class="num">{{ rollup.registered || 0 }}</div><div class="k">花名册登记</div></div></el-col>
        <el-col :span="5"><div class="kpi ok"><div class="num">{{ rollup.relocated || 0 }}</div><div class="k">已确认离开安置</div></div></el-col>
        <el-col :span="4"><div class="kpi danger"><div class="num">{{ rollup.staying || 0 }}</div><div class="k">仍在房屋内</div></div></el-col>
        <el-col :span="4"><div class="kpi danger"><div class="num">{{ rollup.sneakBack || 0 }}</div><div class="k">擅自返回</div></div></el-col>
        <el-col :span="6"><div class="kpi"><div class="num">{{ (rollup.returned) || 0 }}</div><div class="k">销号准许后安全返回</div></div></el-col>
      </el-row>
      <el-progress v-if="rollup.registered" :percentage="Math.round((((rollup.relocated||0)+(rollup.returned||0))/rollup.registered)*100)"
        :status="cleared ? 'success' : 'exception'" style="margin-top:12px" :stroke-width="18"
        :format="() => `${(rollup.relocated||0)+(rollup.returned||0)} / ${rollup.registered} 人已落实清退`" />
      <el-alert v-if="!cleared && rollup.registered" type="error" :closable="false" show-icon style="margin-top:10px"
        :title="`登记 ${rollup.registered} 人、现场仅确认 ${rollup.relocated} 人离开（仍在 ${rollup.staying}、偷返 ${rollup.sneakBack}），房屋不得标记为已清退；拨付与整改销号停在对应环节`" />
      <el-alert v-if="!rollup.registered" type="info" :closable="false" show-icon style="margin-top:10px"
        title="尚未建立逐人花名册。批次转移登记的人数不能直接等同于全员清退，请先按名单或居住人数建立花名册，再逐人现场核对。" />
    </el-card>

    <!-- 花名册 -->
    <el-card shadow="never" style="margin-top:12px">
      <template #header>
        <div class="hd">转移人员花名册
          <div v-if="canEdit">
            <el-button size="small" type="primary" plain @click="openAdd">新增/补录人员</el-button>
            <el-button size="small" @click="genPlaceholders">按居住人数补待核对</el-button>
          </div>
        </div>
      </template>
      <el-table :data="archive.evacPersons || []" size="small" border>
        <el-table-column prop="name" label="姓名" width="150" />
        <el-table-column label="类别" width="120">
          <template #default="{ row }">{{ PERSON_CATEGORY[row.category] || row.category }}</template>
        </el-table-column>
        <el-table-column label="现场核对结论" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="(PERSON_STATUS[row.evacStatus]||{}).type">{{ (PERSON_STATUS[row.evacStatus]||{}).label || row.evacStatus }}</el-tag>
            <el-tag v-if="row.stillOperating" size="small" type="warning" effect="plain" style="margin-left:4px">在经营</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="destination" label="安置点/去向" width="170" />
        <el-table-column prop="settledFrom" label="安置起始" width="110" />
        <el-table-column label="核对照片" width="90">
          <template #default="{ row }">
            <el-image v-if="row.photos?.length" :src="row.photos[0]" :preview-src-list="row.photos"
              fit="cover" style="width:42px;height:42px;border-radius:4px" preview-teleported />
            <span v-else class="sub">未留照片</span>
          </template>
        </el-table-column>
        <el-table-column label="核对人/时间" width="170">
          <template #default="{ row }">
            <div class="sub">{{ row.verifiedByName || '—' }}</div>
            <div class="sub">{{ fmtDay(row.verifiedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button v-if="canEdit" link type="primary" @click="openVerify(row)">现场核对</el-button>
            <el-popconfirm v-if="canEdit" title="从花名册删除该人员？" @confirm="removePerson(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!(archive.evacPersons||[]).length" description="花名册为空" :image-size="70" />
    </el-card>

    <!-- 批次转移登记 -->
    <el-card shadow="never" style="margin-top:12px">
      <template #header>转移安置批次记录（仅记录批次人数，不等于全员清退）</template>
      <el-timeline v-if="archive.evacuations?.length">
        <el-timeline-item v-for="e in archive.evacuations" :key="e.id" :timestamp="fmtDate(e.settledAt)" placement="top">
          <el-tag type="danger">本批 {{ e.residents }} 人</el-tag> → {{ e.destination }}
          <el-tag size="small" :type="e.allowReturn ? 'success' : 'warning'" style="margin-left:6px">{{ e.allowReturn ? '已准许返回' : '管控中' }}</el-tag>
          <div class="sub">{{ e.remark }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无批次转移记录" :image-size="60" />
    </el-card>

    <!-- 新增人员弹窗 -->
    <el-dialog v-model="showAdd" title="新增/补录转移人员" width="480px">
      <el-form label-width="90px">
        <el-form-item label="姓名"><el-input v-model="addForm.name" /></el-form-item>
        <el-form-item label="人员类别">
          <el-select v-model="addForm.category" style="width:100%">
            <el-option v-for="(v,k) in PERSON_CATEGORY" :key="k" :label="v" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="联系电话"><el-input v-model="addForm.phone" /></el-form-item>
        <el-form-item label="是否经营者"><el-switch v-model="addForm.stillOperating" active-text="该人员参与经营" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd=false">取消</el-button>
        <el-button type="primary" @click="submitAdd">加入花名册</el-button>
      </template>
    </el-dialog>

    <!-- 现场核对弹窗 -->
    <el-dialog v-model="showVerify" title="网格员现场核对" width="560px">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        :title="`正在核对：${verifyForm.name}（${PERSON_CATEGORY[verifyForm.category]||''}）`" />
      <el-form label-width="120px">
        <el-form-item label="现场结论">
          <el-radio-group v-model="verifyForm.evacStatus">
            <el-radio-button value="RELOCATED">已离开并安置</el-radio-button>
            <el-radio-button value="STAYING">仍在房屋内</el-radio-button>
            <el-radio-button value="SNEAK_BACK">擅自返回</el-radio-button>
            <el-radio-button value="REGISTERED">待核对</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="verifyForm.evacStatus === 'RELOCATED'">
          <el-form-item label="安置点/去向" required>
            <el-select v-model="verifyForm.destination" allow-create filterable style="width:100%">
              <el-option label="投亲靠友" value="投亲靠友" />
              <el-option label="村级安置点" value="村级安置点" />
              <el-option label="乡镇集中安置点" value="乡镇集中安置点" />
            </el-select>
          </el-form-item>
          <el-form-item label="开始安置日期" required>
            <el-date-picker v-model="verifyForm.settledFrom" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </template>
        <el-form-item v-if="verifyForm.evacStatus === 'STAYING' || verifyForm.evacStatus === 'SNEAK_BACK'" label="仍在继续经营">
          <el-switch v-model="verifyForm.stillOperating" active-text="现场发现其仍在经营/留宿营业" />
        </el-form-item>
        <el-form-item label="现场照片" required>
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>verifyForm.photos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传核对照片</el-button>
          </el-upload>
          <el-image v-for="(u,i) in verifyForm.photos" :key="i" :src="u" :preview-src-list="verifyForm.photos"
            style="width:54px;height:54px;margin:6px 6px 0;border-radius:4px" fit="cover" preview-teleported />
        </el-form-item>
        <el-form-item label="现场情况说明">
          <el-input v-model="verifyForm.remark" type="textarea" :rows="2" :placeholder="verifyForm.evacStatus==='STAYING' ? '仍在房屋内必须填写原因/现场情况' : '安置点签到、是否投亲等'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showVerify=false">取消</el-button>
        <el-button type="primary" @click="submitVerify">保存核对结论</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { PERSON_CATEGORY, PERSON_STATUS, fmtDate, fmtDay } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const canEdit = ['GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const uploadUrl = '/api/upload';
const headers = computed(() => ({ Authorization: `Bearer ${localStorage.getItem('rhs_token')}` }));

const rollup = computed(() => props.archive.evacRollup || { registered: 0, relocated: 0, staying: 0, sneakBack: 0, returned: 0, stillOperating: false, cleared: false });
const cleared = computed(() => !!rollup.value.cleared);

const showAdd = ref(false);
const addForm = reactive({ name: '', category: 'RESIDENT', phone: '', stillOperating: false });
function openAdd() {
  Object.assign(addForm, { name: '', category: 'RESIDENT', phone: '', stillOperating: false });
  showAdd.value = true;
}
async function submitAdd() {
  if (!addForm.name) return ElMessage.warning('请填写姓名');
  await http.post(`/api/houses/${props.archive.house.id}/evacuation-roster`, { persons: [{ ...addForm }] });
  ElMessage.success('已加入花名册（待现场核对）');
  showAdd.value = false;
  emit('reload');
}
async function genPlaceholders() {
  await http.post(`/api/houses/${props.archive.house.id}/evacuation-roster`, {});
  ElMessage.success('已按档案居住人数补齐待核对人员');
  emit('reload');
}

const showVerify = ref(false);
const verifyForm = reactive({ id: '', name: '', category: 'RESIDENT', evacStatus: 'RELOCATED', destination: '乡镇集中安置点', settledFrom: '', stillOperating: false, photos: [], remark: '' });
function openVerify(row) {
  Object.assign(verifyForm, {
    id: row.id, name: row.name, category: row.category, evacStatus: row.evacStatus === 'REGISTERED' ? 'RELOCATED' : row.evacStatus,
    destination: row.destination || '乡镇集中安置点', settledFrom: row.settledFrom || '',
    stillOperating: !!row.stillOperating, photos: [...(row.photos || [])], remark: row.remark || '',
  });
  showVerify.value = true;
}
async function submitVerify() {
  await http.post(`/api/evacuation-persons/${verifyForm.id}/verify`, { ...verifyForm });
  ElMessage.success('现场核对结论已保存');
  showVerify.value = false;
  emit('reload');
}
async function removePerson(row) {
  await http.delete(`/api/evacuation-persons/${row.id}`);
  ElMessage.success('已删除');
  emit('reload');
}
</script>
<style scoped>
.hd { display:flex; align-items:center; justify-content:space-between; font-weight:600; }
.card-gate { border-left:4px solid #f56c6c; }
.kpi { background:#f7f9fc; border-radius:8px; padding:12px; text-align:center; }
.kpi.ok { background:#f0f9eb; } .kpi.danger { background:#fef0f0; }
.kpi .num { font-size:26px; font-weight:700; } .kpi .k { font-size:12px; color:#7a8899; margin-top:2px; }
.sub { color:#8a97a6; font-size:12px; }
</style>
