<template>
  <el-card shadow="never">
    <div class="filters">
      <el-input v-model="q.q" placeholder="档案号 / 户主 / 地址 / 村" clearable style="width:240px" @keyup.enter="load" />
      <el-select v-model="q.township" placeholder="乡镇" clearable style="width:130px" @change="load">
        <el-option v-for="t in townships" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="q.riskLevel" placeholder="风险等级" clearable style="width:130px" @change="load">
        <el-option v-for="(v,k) in RISK" :key="k" :label="v.label" :value="k" />
      </el-select>
      <el-select v-model="q.status" placeholder="治理状态" clearable style="width:140px" @change="load">
        <el-option v-for="(v,k) in STATUS" :key="k" :label="v.label" :value="k" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <el-button v-if="canInspect" type="success" @click="$router.push('/inspect')">巡查登记</el-button>
      <span class="cnt">共 {{ total }} 栋</span>
    </div>
    <el-table :data="rows" v-loading="loading" border size="small" @row-click="open" style="cursor:pointer">
      <el-table-column prop="code" label="档案号" width="150" />
      <el-table-column label="位置" min-width="200">
        <template #default="{ row }">{{ row.township }} · {{ row.village }} · {{ row.address }}</template>
      </el-table-column>
      <el-table-column prop="ownerName" label="户主" width="90" />
      <el-table-column label="基本情况" width="230">
        <template #default="{ row }">
          <span>{{ row.buildYear }}年建 · {{ row.floors }}层 · {{ row.residents }}人</span>
          <el-tag v-if="row.isBusiness" size="small" type="warning" effect="plain" style="margin-left:4px">经营</el-tag>
          <el-tag v-if="row.isRented" size="small" type="warning" effect="plain">出租</el-tag>
          <el-tag v-if="row.isAddedFloor" size="small" type="danger" effect="plain">加层</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="风险" width="100">
        <template #default="{ row }"><el-tag size="small" :type="RISK[row.riskLevel].type">{{ RISK[row.riskLevel].label }}</el-tag></template>
      </el-table-column>
      <el-table-column label="状态" width="150">
        <template #default="{ row }">
          <el-tag size="small" :type="STATUS[row.status]?.type">{{ STATUS[row.status]?.label }}</el-tag>
          <el-tag v-if="row.registeredCount > 0 && !row.evictionCleared" size="small" type="danger" effect="dark" style="margin-left:2px">未清退</el-tag>
          <el-tag v-else-if="row.evictionCleared" size="small" type="success" effect="plain" style="margin-left:2px">已清退</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="风险依据" min-width="260">
        <template #default="{ row }">
          <el-text v-for="(r,i) in (row.ruleReasons||[]).slice(0,3)" :key="i" size="small" type="info">{{ r }}；</el-text>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import http from '../api';
import { RISK, STATUS } from '../labels';
import { useAuthStore } from '../store';

const auth = useAuthStore();
const canInspect = computed(() => ['GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role));
const router = useRouter();
const q = reactive({ q: '', township: auth.user?.township && ['GRID_WORKER', 'TOWNSHIP_REVIEWER'].includes(auth.role) ? auth.user.township : '', riskLevel: '', status: '' });
const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const townships = ['溪口镇', '云岭乡', '青山镇'];
function open(row) { router.push(`/houses/${row.id}`); }
async function load() {
  loading.value = true;
  try {
    const { data } = await http.get('/api/houses', { params: q });
    rows.value = data.data;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.filters { display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap; align-items:center; }
.cnt { color:#8a97a6; font-size:13px; margin-left:auto; }
</style>
