<template>
  <div>
    <!-- 转移清册总览 -->
    <el-card shadow="never">
      <template #header>
        人员转移清册 · 网格员现场逐人核对
        <el-tag v-if="roster.state==='FULL'" type="success" size="large" style="margin-left:10px">全员已清退（{{ roster.resettled }}/{{ roster.total }}）</el-tag>
        <el-tag v-else-if="roster.state==='RETURNED'" type="danger" size="large" style="margin-left:10px">有人擅自返回 · 原事件续办</el-tag>
        <el-tag v-else-if="roster.state==='PARTIAL'" type="danger" size="large" style="margin-left:10px">未清退（{{ roster.resettled }}/{{ roster.total }} 已离开）</el-tag>
        <el-tag v-else type="info" size="large" style="margin-left:10px">尚未建立清册</el-tag>
      </template>

      <el-row :gutter="10">
        <el-col :span="4"><div class="kpi"><div class="n">{{ roster.total }}</div><div class="k">登记应转移</div></div></el-col>
        <el-col :span="4"><div class="kpi ok"><div class="n">{{ roster.resettled }}</div><div class="k">确认已离开安置</div></div></el-col>
        <el-col :span="4"><div class="kpi danger"><div class="n">{{ roster.stillOnSite }}</div><div class="k">仍在现场</div></div></el-col>
        <el-col :span="4"><div class="kpi danger"><div class="n">{{ roster.returned }}</div><div class="k">擅自返回</div></div></el-col>
        <el-col :span="4"><div class="kpi warn"><div class="n">{{ roster.continuingBusiness }}</div><div class="k">仍在继续经营</div></div></el-col>
        <el-col :span="4"><div class="kpi"><div class="n">{{ archive.shelters?.length || 0 }}</div><div class="k">安置点</div></div></el-col>
      </el-row>

      <el-alert v-if="roster.state==='PARTIAL'" type="error" :closable="false" show-icon style="margin-top:12px"
        title="登记人数与现场核对不符：不得把房屋标成已清退；开工、验收、销号、补助拨付均停在对应环节。补助申请可保留，核定后也须全员转移且销号有效方可拨付。" />
      <el-alert v-if="roster.state==='RETURNED'" type="error" :closable="false" show-icon style="margin-top:12px"
        title="现场核查发现转移人员整改期间偷偷返回/继续经营：按原事件继续处理（不新建记录），旧销号结论已撤销，须劝返并全员复核后才能重新销号。" />
      <div v-if="archive.close && !archive.closeValid" style="margin-top:8px">
        <el-tag type="danger" effect="plain">原销号结论已被撤销（{{ fmtDate(archive.close.revokedAt) }}），不再有效</el-tag>
      </div>

      <!-- 清册表格 -->
      <el-table :data="archive.evacPersons||[]" size="small" border style="margin-top:12px">
        <el-table-column prop="name" label="姓名" width="130" />
        <el-table-column label="身份" width="120">
          <template #default="{row}">{{ PERSON_ROLE[row.role] || row.role }}</template>
        </el-table-column>
        <el-table-column label="现场核对状态" width="130">
          <template #default="{row}">
            <el-tag size="small" :type="(PERSON_MOVE[row.moveStatus]||{}).type">{{ (PERSON_MOVE[row.moveStatus]||{}).label || row.moveStatus }}</el-tag>
            <el-tag v-if="row.continueBusiness" size="small" type="warning" effect="plain" style="margin-left:2px">继续经营</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="shelterName" label="安置去向" min-width="150">
          <template #default="{row}">{{ row.shelterName || '—' }}</template>
        </el-table-column>
        <el-table-column label="起始安置" width="105">
          <template #default="{row}">{{ fmtDay(row.settledFrom) }}</template>
        </el-table-column>
        <el-table-column label="照片" width="80">
          <template #default="{row}">
            <el-image v-if="row.photos?.length" :src="row.photos[0]" :preview-src-list="row.photos"
              fit="cover" style="width:42px;height:32px;border-radius:4px" preview-teleported />
            <span v-else style="color:#b0b8c2">无</span>
          </template>
        </el-table-column>
        <el-table-column label="核对人/时间" width="170">
          <template #default="{row}">
            <div v-if="row.verifiedAt" class="sub">{{ row.verifiedByName }}<br/>{{ fmtDate(row.verifiedAt) }}</div>
            <span v-else class="sub">待核对</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{row}">
            <el-button v-if="canStaff" link type="primary" size="small" @click="openVerify(row)">现场核对</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="canStaff" style="margin-top:10px">
        <el-button size="small" type="primary" plain @click="showRoster=true">
          {{ (archive.evacPersons?.length || 0) ? '补登应转移人员' : '建立转移人员清册' }}
        </el-button>
      </div>
    </el-card>

    <!-- 整改期间现场核查 -->
    <el-card v-if="canStaff" shadow="never" style="margin-top:12px">
      <template #header>整改期间现场核查（同一事件续办，不新建记录）</template>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:10px"
        title="网格员复查时若发现有人偷偷返回或仍在经营，在此登记：系统将按原事件续办、冻结验收销号、撤销旧销号；不新建房屋记录。" />
      <el-button size="small" type="danger" plain @click="openRecheck">登记一次现场核查</el-button>

      <!-- 偷返续办处置 -->
      <div v-for="iss in returnIssues" :key="iss.id" class="issue-box">
        <el-tag type="danger" size="small">偷返/偷营业 · 待处置</el-tag>
        <span class="sub" style="margin-left:8px">{{ iss.description }}</span>
        <el-form label-width="120px" size="small" style="margin-top:8px">
          <el-form-item label="已劝返人员">
            <el-select v-model="resolveMap[iss.id].personIds" multiple placeholder="选择已劝回安置点的人员" style="width:360px">
              <el-option v-for="p in archive.evacPersons||[]" :key="p.id" :value="p.id" :label="`${p.name}（${PERSON_ROLE[p.role]}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="重新安置去向">
            <el-select v-model="resolveMap[iss.id].shelterName" allow-create filterable style="width:260px">
              <el-option v-for="s in archive.shelters||[]" :key="s.id" :value="s.name" :label="`${s.name}（${s.township||''}）`" />
            </el-select>
            <el-date-picker v-model="resolveMap[iss.id].settledFrom" type="date" value-format="YYYY-MM-DD" placeholder="重新安置起始日" style="margin-left:8px" />
          </el-form-item>
          <el-form-item label="现场照片">
            <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>resolveMap[iss.id].photos.push(r.url)" :show-file-list="false">
              <el-button size="small">上传照片</el-button>
            </el-upload>
            <el-tag v-for="(u,i) in resolveMap[iss.id].photos" :key="i" size="small" closable style="margin:2px" @close="resolveMap[iss.id].photos.splice(i,1)">照片{{i+1}}</el-tag>
          </el-form-item>
          <el-form-item label="处置结果（必填）">
            <el-input v-model="resolveMap[iss.id].resolution" type="textarea" :rows="2" style="width:480px" placeholder="劝返过程、安置落实、经营者承诺等" />
          </el-form-item>
          <el-form-item>
            <el-button type="success" size="small" @click="resolveReturn(iss)">劝返完成 · 全员复核并办结</el-button>
            <span class="sub">仅当清册全员重新安置时系统才允许办结</span>
          </el-form-item>
        </el-form>
      </div>
    </el-card>

    <!-- 安置补助 / 经营损失 -->
    <el-card shadow="never" style="margin-top:12px">
      <template #header>安置补助 · 经营损失补偿（申请可保留，核定后须销号有效方可拨付）</template>
      <el-table :data="archive.allowances||[]" size="small" border>
        <el-table-column label="类型" width="120">
          <template #default="{row}">{{ ALLOWANCE_TYPE[row.type] }}</template>
        </el-table-column>
        <el-table-column prop="basis" label="核算依据" min-width="200" />
        <el-table-column label="申请/核定" width="150">
          <template #default="{row}">¥{{ Number(row.approvedAmount || row.amount).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{row}"><el-tag size="small" :type="(ALLOWANCE_STATUS[row.status]||{}).type">{{ (ALLOWANCE_STATUS[row.status]||{}).label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{row}">
            <template v-if="row.status==='APPLIED' && canReviewAllowance">
              <el-button link type="success" size="small" @click="reviewAllowance(row,true)">核定通过</el-button>
              <el-button link type="danger" size="small" @click="reviewAllowance(row,false)">驳回</el-button>
            </template>
            <el-button v-if="row.status==='APPROVED' && auth.isCounty" link type="warning" size="small" @click="payAllowance(row)">拨付</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="canApplyAllowance" style="margin-top:10px">
        <el-button size="small" type="primary" plain @click="showAllowance=true">申请安置补助/经营损失</el-button>
        <span class="sub">拨付闸口：全员转移清退 + 有效销号，缺一不可。</span>
      </div>
    </el-card>

    <!-- 复营业 -->
    <el-card v-if="archive.house?.isBusiness" shadow="never" style="margin-top:12px">
      <template #header>恢复经营（销号有效且经准许后方可复营业）</template>
      <template v-if="archive.house?.resumeBusinessApproved">
        <el-tag type="success">已于 {{ fmtDate(archive.house.resumeBusinessAt) }} 准许恢复经营</el-tag>
      </template>
      <template v-else>
        <el-tag type="warning" effect="plain">停业整改中，未获准许不得恢复经营</el-tag>
        <div v-if="canReviewAllowance" style="margin-top:8px">
          <el-button size="small" type="success" @click="resumeBusiness">准许复营业</el-button>
          <span class="sub">须先完成有效销号且无未办结阻断问题；销号被撤销时本操作被拒绝。</span>
        </div>
      </template>
    </el-card>

    <!-- 建立/补登清册对话框 -->
    <el-dialog v-model="showRoster" title="建立转移人员清册（每行：姓名|身份）" width="520px">
      <el-input v-model="rosterText" type="textarea" :rows="7"
        :placeholder="`周小满|OWNER\n周凯（经营者）|OPERATOR\n租户老陈|TENANT\n身份：OWNER 户主 / RESIDENT 常住 / TENANT 租户 / OPERATOR 经营者 / EMPLOYEE 从业人员`" />
      <template #footer>
        <el-button @click="showRoster=false">取消</el-button>
        <el-button type="primary" @click="submitRoster">登记入册</el-button>
      </template>
    </el-dialog>

    <!-- 现场逐人核对对话框 -->
    <el-dialog v-model="showVerify" title="网格员现场核对" width="560px">
      <el-form label-width="110px">
        <el-form-item label="人员">
          <b>{{ verifyForm.name }}</b>（{{ PERSON_ROLE[verifyForm.role] }}）
        </el-form-item>
        <el-form-item label="现场结论">
          <el-radio-group v-model="verifyForm.moveStatus">
            <el-radio-button value="RESETTLED">已离开并安置</el-radio-button>
            <el-radio-button value="STILL_ON_SITE">仍在现场</el-radio-button>
            <el-radio-button value="RETURNED">擅自返回</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="verifyForm.moveStatus==='RESETTLED'">
          <el-form-item label="安置点/去向">
            <el-select v-model="verifyForm.shelterName" allow-create filterable placeholder="选择或填写安置点" style="width:320px">
              <el-option v-for="s in archive.shelters||[]" :key="s.id" :value="s.name" :label="`${s.name}（${s.township||''}）`" />
              <el-option label="投亲靠友" value="投亲靠友" />
            </el-select>
          </el-form-item>
          <el-form-item label="从哪天安置">
            <el-date-picker v-model="verifyForm.settledFrom" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
        </template>
        <el-form-item v-if="verifyForm.moveStatus==='STILL_ON_SITE'" label="仍在继续经营">
          <el-switch v-model="verifyForm.continueBusiness" active-text="该人员仍在现场继续经营" />
        </el-form-item>
        <el-form-item label="现场照片（必传）">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>verifyForm.photos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in verifyForm.photos" :key="i" size="small" closable style="margin:2px" @close="verifyForm.photos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="verifyForm.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showVerify=false">取消</el-button>
        <el-button type="primary" @click="submitVerify">提交现场核对</el-button>
      </template>
    </el-dialog>

    <!-- 整改期间现场核查对话框 -->
    <el-dialog v-model="showRecheckDlg" title="整改期间现场核查" width="560px">
      <el-form label-width="130px">
        <el-form-item label="发现仍在房内人数"><el-input-number v-model="recheckForm.foundOnSite" :min="0" /></el-form-item>
        <el-form-item label="点名擅自返回者">
          <el-select v-model="recheckForm.personIds" multiple style="width:360px" placeholder="清册中已安置但现场发现返回的人">
            <el-option v-for="p in archive.evacPersons||[]" :key="p.id" :value="p.id" :label="`${p.name}（${PERSON_ROLE[p.role]}）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="发现偷偷经营"><el-switch v-model="recheckForm.foundOperating" /></el-form-item>
        <el-form-item label="现场照片">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>recheckForm.photos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in recheckForm.photos" :key="i" size="small" closable style="margin:2px" @close="recheckForm.photos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
        <el-form-item label="情况说明"><el-input v-model="recheckForm.notes" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRecheckDlg=false">取消</el-button>
        <el-button type="danger" @click="submitRecheck">提交核查（异常则原事件续办）</el-button>
      </template>
    </el-dialog>

    <!-- 安置/经营补助申请对话框 -->
    <el-dialog v-model="showAllowance" title="安置补助 / 经营损失申请" width="520px">
      <el-form label-width="100px">
        <el-form-item label="类型">
          <el-radio-group v-model="allowanceForm.type">
            <el-radio-button value="RESETTLEMENT">安置补助</el-radio-button>
            <el-radio-button value="BUSINESS_LOSS">经营损失</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="申请金额(元)"><el-input-number v-model="allowanceForm.amount" :min="0" :step="500" /></el-form-item>
        <el-form-item label="核算依据">
          <el-input v-model="allowanceForm.basis" type="textarea" :rows="3"
            :placeholder="allowanceForm.type==='RESETTLEMENT' ? '如：5人×30天×40元/人天=6000元' : '如：停业30天，日损失约300元×30天=9000元'" />
        </el-form-item>
        <el-form-item label="佐证材料">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>allowanceForm.proof.push(r.url)" :show-file-list="false">
            <el-button size="small">上传</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in allowanceForm.proof" :key="i" size="small" closable style="margin:2px" @close="allowanceForm.proof.splice(i,1)">材料{{i+1}}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAllowance=false">取消</el-button>
        <el-button type="primary" @click="submitAllowance">提交申请（可保留待审）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { PERSON_ROLE, PERSON_MOVE, ALLOWANCE_TYPE, ALLOWANCE_STATUS, fmtDate, fmtDay } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const uploadUrl = '/api/upload';
const headers = computed(() => ({ Authorization: `Bearer ${localStorage.getItem('rhs_token')}` }));
const houseId = computed(() => props.archive.house?.id);
const roster = computed(() => props.archive.roster || { state: 'NONE', total: 0, resettled: 0, stillOnSite: 0, returned: 0, continuingBusiness: 0 });
const canStaff = ['GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canReviewAllowance = ['TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canApplyAllowance = ['FARMER', 'GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);

const returnIssues = computed(() =>
  (props.archive.issues || []).filter((i) => i.type === 'PERSON_RETURN' && i.status !== 'RESOLVED'),
);

const showRoster = ref(false);
const rosterText = ref('');
const showVerify = ref(false);
const verifyForm = reactive({ id: '', name: '', role: 'RESIDENT', moveStatus: 'RESETTLED', shelterName: '', settledFrom: '', continueBusiness: false, photos: [], remark: '' });
const showRecheckDlg = ref(false);
const recheckForm = reactive({ foundOnSite: 0, personIds: [], foundOperating: false, photos: [], notes: '' });
const showAllowance = ref(false);
const allowanceForm = reactive({ type: 'RESETTLEMENT', amount: 3000, basis: '', proof: [] });
const resolveMap = reactive({});
watch(
  () => props.archive.issues,
  (issues) => {
    for (const iss of issues || []) {
      if (iss.type === 'PERSON_RETURN' && iss.status !== 'RESOLVED' && !resolveMap[iss.id]) {
        resolveMap[iss.id] = { personIds: [], shelterName: '', settledFrom: '', photos: [], resolution: '' };
      }
    }
  },
  { immediate: true,
});

function openVerify(row) {
  Object.assign(verifyForm, {
    id: row.id, name: row.name, role: row.role,
    moveStatus: row.moveStatus === 'RETURNED' ? 'RETURNED' : 'RESETTLED',
    shelterName: row.shelterName || '', settledFrom: row.settledFrom || '',
    continueBusiness: !!row.continueBusiness, photos: Array.isArray(row.photos) ? [...row.photos] : [], remark: row.remark || '',
  });
  showVerify.value = true;
}

async function submitRoster() {
  const persons = rosterText.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, role] = l.split('|').map((x) => (x || '').trim());
    return { name, role: role || 'RESIDENT' };
  }).filter((p) => p.name);
  if (!persons.length) return ElMessage.warning('请至少填写一名人员');
  await http.post(`/api/houses/${houseId.value}/roster`, { persons });
  ElMessage.success('清册已建立，等待网格员现场逐人核对');
  showRoster.value = false;
  rosterText.value = '';
  emit('reload');
}

async function submitVerify() {
  if (!verifyForm.photos.length) return ElMessage.warning('现场核对必须上传照片');
  const payload = { ...verifyForm };
  delete payload.id; delete payload.name; delete payload.role;
  await http.post(`/api/evacuation-persons/${verifyForm.id}/verify`, payload);
  ElMessage.success('现场核对已记录');
  showVerify.value = false;
  emit('reload');
}

function openRecheck() {
  Object.assign(recheckForm, { foundOnSite: 0, personIds: [], foundOperating: false, photos: [], notes: '' });
  showRecheckDlg.value = true;
}
async function submitRecheck() {
  const foundSomething = recheckForm.foundOnSite > 0 || recheckForm.personIds.length || recheckForm.foundOperating;
  if (foundSomething && !recheckForm.photos.length) return ElMessage.warning('发现偷返/偷营业必须留存现场照片');
  const { data } = await http.post('/api/rechecks/during', { houseId: houseId.value, ...recheckForm });
  ElMessage[data.foundViolation ? 'warning' : 'success'](data.foundViolation ? '发现违规，已按原事件续办并冻结相关环节' : '核查正常，已记录');
  showRecheckDlg.value = false;
  emit('reload');
}

async function resolveReturn(iss) {
  const f = resolveMap[iss.id] || { personIds: [], photos: [], resolution: '' };
  await http.post(`/api/issues/${iss.id}/return-resolved`, { ...f });
  ElMessage.success('已劝返并全员复核，续办异常办结');
  emit('reload');
}

async function submitAllowance() {
  if (!allowanceForm.basis) return ElMessage.warning('请填写核算依据');
  await http.post(`/api/houses/${houseId.value}/allowances`, { ...allowanceForm });
  ElMessage.success('申请已提交，可保留待乡镇核定');
  showAllowance.value = false;
  emit('reload');
}
async function reviewAllowance(row, approved) {
  let approvedAmount = Number(row.amount);
  let comment = '';
  if (approved) {
    const v = await ElMessageBox.prompt(`核定金额（不超过申请 ¥${row.amount}）`, '核定', { inputValue: String(approvedAmount) });
    approvedAmount = Number(v.value);
  } else {
    const v = await ElMessageBox.prompt('驳回原因', '核定未通过', { inputType: 'textarea' });
    comment = v.value;
  }
  await http.post(`/api/allowances/${row.id}/review`, { approved, approvedAmount, comment });
  ElMessage.success(approved ? '已核定通过，待销号有效后拨付' : '已驳回');
  emit('reload');
}
async function payAllowance(row) {
  await ElMessageBox.confirm('确认该房屋全员转移、销号有效，拨付该笔补助？', '拨付', { type: 'warning' });
  await http.post(`/api/allowances/${row.id}/pay`, {});
  ElMessage.success('补助已拨付');
  emit('reload');
}
async function resumeBusiness() {
  const { value } = await ElMessageBox.prompt('可附复营业条件（如限单层经营、定期巡查），无则留空', '准许复营业', {
    inputPlaceholder: '可选', confirmButtonText: '确认准许',
  }).catch(() => ({ value: null }));
  if (value === null) return;
  await http.post(`/api/houses/${houseId.value}/resume-business`, { condition: value || '' });
  ElMessage.success('已准许恢复经营');
  emit('reload');
}
</script>

<style scoped>
.kpi { background:#f7f9fc; border-radius:8px; padding:12px; text-align:center; }
.kpi.ok { background:#f0f9eb; } .kpi.danger { background:#fef0f0; } .kpi.warn { background:#fdf6ec; }
.kpi .n { font-size:24px; font-weight:700; }
.kpi .k { color:#7a8899; font-size:12px; margin-top:2px; }
.sub { color:#8a97a6; font-size:12px; }
.issue-box { border:1px solid #f8b8b8; background:#fff7f7; border-radius:8px; padding:10px 12px; margin-top:10px; }
</style>
