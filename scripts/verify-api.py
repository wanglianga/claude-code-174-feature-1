import json, urllib.request, urllib.error

BASE = 'http://localhost:3000/api'

def req(method, path, token=None, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, (json.loads(raw) if raw.strip() else {})

def login(u):
    _, d = req('POST', '/auth/login', data={'username': u, 'password': '123456'})
    return d['token']

county = login('county1'); town1 = login('town1'); town2 = login('town2')
town3 = login('town3'); grid1 = login('grid1'); grid3 = login('grid3')
acceptor = login('acceptor1'); farmer2 = login('farmer2'); farmer3 = login('farmer3'); team = login('team1')
fails = []
def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), name, detail)
    if not cond: fails.append(name)

def house_by_code(code, token):
    _, d = req('GET', '/houses?q=' + code, token)
    return d['data'][0]

def archive(code, token=county):
    h = house_by_code(code, token)
    return h, req('GET', f"/houses/{h['id']}/archive", token)[1]

# ---------- B房屋：偷换材料阻断验收 ----------
b = house_by_code('NF-YL-000002', county)
arc_b = req('GET', f"/houses/{b['id']}/archive", county)[1]
plan_b = arc_b['plans'][0]
blocking = [i['type'] for i in arc_b['blockingIssues']]
check('B-偷换材料生成阻断异常', 'MATERIAL_SWAP' in blocking, str(blocking))

results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_b['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': b['id'], 'itemResults': results})
check('B-阻断异常未办结禁止验收', st == 400, d.get('message', '')[:60])

_, teamlist = req('GET', '/teams', county)
bad_team = [t for t in teamlist if not t['qualified']][0]
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': b['id'], 'teamId': bad_team['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-01',
    'budgetItems': [{'name': '防水卷材', 'spec': 'SBS 4mm', 'qty': 10, 'unit': '㎡', 'unitPrice': 45}]})
check('B-阻断异常时连提交计划也被拦截', st == 400 and '阻断' in d['message'], d.get('message', '')[:60])

swap = arc_b['issues'][0]
st, d = req('POST', f"/issues/{swap['id']}/status", town2, {'status': 'RESOLVED'})
check('B-办结问题必须填处置结果', st == 400)
st, d = req('POST', f"/issues/{swap['id']}/status", town2,
            {'status': 'RESOLVED', 'resolution': '清退非标卷材，更换为SBS 4mm合格材料并复验'})
check('B-问题可办结', st in (200, 201))

sub_b = arc_b['subsidy']
st, d = req('POST', f"/subsidies/{sub_b['id']}/pay", county)
check('B-未销号禁止发补助', st == 400 and '销号' in d['message'], d.get('message', '')[:60])

# ---------- C房屋：拒绝整改/租户不搬，告知与开工制约 ----------
c = house_by_code('NF-QS-000003', county)
arc_c = req('GET', f"/houses/{c['id']}/archive", county)[1]
st, d = req('POST', '/notices', grid3, {'houseId': c['id'], 'method': '现场告知',
                                        'notifiedTo': ['户主'], 'acknowledged': False})
check('C-暂停使用房屋告知未签收被拒', st == 400 and '签收' in d['message'], d.get('message', '')[:60])
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': c['id'], 'teamId': [t for t in teamlist if t['qualified']][0]['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-10',
    'budgetItems': [{'name': '拆除', 'qty': 1, 'unit': '项', 'unitPrice': 1000}]})
check('C-阻断问题+未告知禁止开工', st == 400, d.get('message', '')[:60])

# ---------- A房屋：销号+补助已发，复查通过 ----------
a = house_by_code('NF-XK-000001', county)
arc_a = req('GET', f"/houses/{a['id']}/archive", county)[1]
check('A-状态为已销号', a['status'] == 'CLOSED')
check('A-补助已发放', arc_a['subsidy']['status'] == 'PAID')
check('A-转移人员已准许返回', arc_a['evacuations'][0]['allowReturn'] is True)
check('A-花名册5人全员清退(安全返回)', arc_a['evacRollup']['registered'] == 5 and arc_a['evacRollup']['cleared'] is True)
st, d = req('POST', f"/subsidies/{arc_a['subsidy']['id']}/pay", county)
check('A-补助不可重复发放', st == 400)

# ---------- E房屋：验收不通过自动生成阻断异常 ----------
e = house_by_code('NF-XK-000005', county)
arc_e = req('GET', f"/houses/{e['id']}/archive", county)[1]
check('E-验收不通过状态', e['status'] == 'ACCEPTANCE_FAILED')
check('E-验收失败阻断异常', any(i['type'] == 'ACCEPTANCE_FAIL' and i['blocksWorkflow'] for i in arc_e['issues']))
plan_e = arc_e['plans'][0]
results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_e['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': e['id'], 'itemResults': results})
check('E-阻断异常未办结不能重新验收', st == 400 and '阻断' in d['message'], d.get('message', '')[:50])

# ---------- F房屋：复查反弹后重新治理并再次销号 ----------
f = house_by_code('NF-QS-000006', county)
arc_f = req('GET', f"/houses/{f['id']}/archive", county)[1]
check('F-反弹状态', f['status'] == 'REBOUND')
reb = [i for i in arc_f['issues'] if i['type'] == 'REBOUND'][0]
req('POST', f"/issues/{reb['id']}/status", town3, {'status': 'RESOLVED', 'resolution': '协调邻户停工，重新加固'})
insp_f = arc_f['inspections'][0]
st, d = req('POST', '/reviews', town3, {
    'inspectionId': insp_f['id'], 'decision': 'RECTIFY', 'deadline': '2026-11-20',
    'items': [
        {'type': 'REINFORCE_WALL', 'description': '新增贯通裂缝墙体加固'},
        {'type': 'SET_WARNING', 'description': '邻户施工期间设置监测警示'},
    ]})
check('F-反弹房屋允许重新复核', st in (200, 201), str(d)[:80])
plan2 = d if st in (200,201) else None
if plan2:
    req('POST', '/notices', grid3, {'houseId': f['id'], 'method': '现场告知',
                                    'notifiedTo': ['户主'], 'acknowledged': True})
    for it in plan2['items']:
        req('POST', f"/rectification-items/{it['id']}/status", town3, {'status': 'DONE'})
    results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan2['items']]
    st, d = req('POST', '/acceptances', acceptor, {'houseId': f['id'], 'itemResults': results, 'comment': '复验合格'})
    check('F-重新验收通过', st in (200, 201), str(d)[:80])
    st, d = req('POST', '/closes', county, {'houseId': f['id'], 'confirmedAllItems': True,
                                            'confirmedStopUseLifted': True})
    check('F-允许二次销号', st in (200, 201), str(d)[:80])

# ================= 新增：人员转移清退口径全链路 =================
# ---------- G房屋：登记6人仅确认5人离开，经营者仍在偷偷营业 ----------
g, arc_g = archive('NF-QS-000007')
rg = arc_g['evacRollup']
check('G-花名册登记6人', rg['registered'] == 6, str(rg))
check('G-仅确认5人离开', rg['relocated'] == 5)
check('G-1人仍在房屋内', rg['staying'] == 1)
check('G-未标记已清退', arc_g['house']['evictionCleared'] is False and rg['cleared'] is False)
check('G-现场核对仍在经营', rg['stillOperating'] is True)
check('G-补助申请保留但停在草稿(未进复核)', arc_g['subsidy']['status'] == 'DRAFT')
check('G-安置补助已核定(可保留)', arc_g['aid']['status'] == 'APPROVED')
check('G-未销号状态为已停用(非已转移)', arc_g['house']['status'] == 'STOPPED')

gid = g['id']
g_plan = arc_g['plans'][0]
g_items = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in g_plan['items']]
qualified_team = [t for t in teamlist if t['qualified']][0]['id']
budget = [{'name': '加固工程', 'qty': 1, 'unit': '项', 'unitPrice': 20000}]

# 未全员清退：开工/验收/销号/拨付/复业 全部拦截
st, d = req('POST', '/construction-plans', farmer3, {'houseId': gid, 'teamId': qualified_team,
    'startDate': '2026-10-10', 'endDate': '2026-11-10', 'budgetItems': budget})
check('G-5/6人离开禁止开工', st == 400 and '清退' in d['message'], d.get('message', '')[:80])
st, d = req('POST', '/acceptances', acceptor, {'houseId': gid, 'itemResults': g_items})
check('G-未清退禁止验收', st == 400 and '清退' in d['message'], d.get('message', '')[:80])
st, d = req('POST', '/closes', county, {'houseId': gid, 'confirmedAllItems': True, 'confirmedStopUseLifted': True})
check('G-未清退禁止销号', st == 400 and '清退' in d['message'], d.get('message', '')[:80])
st, d = req('POST', f"/aids/{arc_g['aid']['id']}/pay", county)
check('G-安置补助未销号禁止拨付', st == 400 and '销号' in d['message'], d.get('message', '')[:80])
st, d = req('POST', f"/houses/{gid}/resumptions", farmer3, {'businessName': '何家快餐店', 'applicantName': '何大勇'})
check('G-未有效销号禁止申请复营业', st == 400 and '销号' in d['message'], d.get('message', '')[:80])

# 现场核对校验：缺安置点/起始日/说明必须报错
owner = [p for p in arc_g['evacPersons'] if p['evacStatus'] == 'STAYING'][0]
st, d = req('POST', f"/evacuation-persons/{owner['id']}/verify", grid3, {'evacStatus': 'RELOCATED'})
check('G-确认离开缺安置点被拒', st == 400 and '安置' in d['message'], d.get('message', '')[:60])
st, d = req('POST', f"/evacuation-persons/{owner['id']}/verify", grid3,
            {'evacStatus': 'RELOCATED', 'destination': '青山镇集中安置点'})
check('G-确认离开缺起始日被拒', st == 400 and '日期' in d['message'], d.get('message', '')[:60])
st, d = req('POST', f"/evacuation-persons/{owner['id']}/verify", grid3, {'evacStatus': 'STAYING'})
check('G-核对仍在屋内缺说明被拒', st == 400)

# 第6人现场确认离开（带安置点/起始日/照片）→ 全员清退，房屋转“已转移”
st, d = req('POST', f"/evacuation-persons/{owner['id']}/verify", grid3, {
    'evacStatus': 'RELOCATED', 'destination': '青山镇集中安置点', 'settledFrom': '2026-09-30',
    'photos': ['/uploads/demo-owner-evac.jpg'], 'remark': '再次上门做通工作，店主搬至安置点'})
check('G-第6人核对离开成功', st in (200, 201), str(d)[:80])
check('G-花名册全员清退', d['rollup']['cleared'] is True and d['rollup']['relocated'] == 6)
g2 = house_by_code('NF-QS-000007', county)
check('G-全员清退后房屋转已转移', g2['status'] == 'EVACUATED')

# 全员清退后走完 开工→施工完成→补助→验收→销号
st, d = req('POST', '/construction-plans', farmer3, {'houseId': gid, 'teamId': qualified_team,
    'startDate': '2026-10-10', 'endDate': '2026-11-10', 'budgetItems': budget})
check('G-全员清退后允许开工', st in (200, 201), str(d)[:80])
g_plan = req('GET', f"/houses/{gid}/archive", county)[1]['plans'][0]
for it in g_plan['items']:
    req('POST', f"/rectification-items/{it['id']}/status", town3, {'status': 'DONE'})
st, d = req('POST', f"/houses/{gid}/subsidy", farmer3, {'amount': 10000})
check('G-清退后资格校验全过进入复核', d['allPass'] is True and d['application']['status'] == 'SUBMITTED', str(d)[:100])
req('POST', f"/subsidies/{d['application']['id']}/review", town3, {'approved': True, 'comment': '同意补助，销号后发放'})
g_items = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in g_plan['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': gid, 'itemResults': g_items, 'comment': '逐项合格'})
check('G-验收通过', st in (200, 201), str(d)[:80])
st, d = req('POST', '/closes', county, {'houseId': gid, 'confirmedAllItems': True, 'confirmedStopUseLifted': True,
                                        'remark': '人员全员清退且整改合格'})
check('G-允许销号', st in (200, 201), str(d)[:80])
arc_g = req('GET', f"/houses/{gid}/archive", county)[1]
g_sub = arc_g['subsidy']
st, d = req('POST', f"/subsidies/{g_sub['id']}/pay", county)
check('G-销号后整改补助可发放', st in (200, 201))
st, d = req('POST', f"/aids/{arc_g['aid']['id']}/pay", county)
check('G-销号后安置补助可拨付', st in (200, 201))
# 经营损失：申报→核定
st, d = req('POST', f"/houses/{gid}/business-losses", farmer3, {
    'businessName': '何家快餐店', 'operatorName': '何大勇', 'monthlyRevenue': 30000,
    'closedDays': 25, 'claimedAmount': 9000, 'proofDocs': ['/uploads/demo-loss-g.jpg']})
check('G-经营损失可申报', st in (200, 201))
loss_id = d['id'] if st in (200, 201) else req('GET', f"/houses/{gid}/archive", county)[1]['businessLosses'][0]['id']
st, d = req('POST', f"/business-losses/{loss_id}/review", town3,
            {'approved': True, 'verifiedAmount': 6000, 'comment': '按流水核定停业损失6000元'})
check('G-乡镇可核定经营损失', st in (200, 201) and d['status'] == 'VERIFIED')
# 复营业：申请→核准日期
st, d = req('POST', f"/houses/{gid}/resumptions", farmer3,
            {'businessName': '何家快餐店', 'applicantName': '何大勇', 'applyReason': '加固完成，申请恢复营业'})
check('G-有效销号后可申请复营业', st in (200, 201))
rid = d['id']
st, d = req('POST', f"/resumptions/{rid}/review", town3,
            {'approved': True, 'resumeFrom': '2026-11-15', 'comment': '现场复核安全，同意复业'})
check('G-乡镇核准复营业并给出起始日', st in (200, 201) and d['resumeFrom'] == '2026-11-15')

# 经营者整改/销号后偷返：下一次复查接着原事件处理，旧销号作废
st, d = req('POST', '/rechecks', grid3, {
    'houseId': gid, 'result': 'FAIL', 'sneakReturn': True, 'personIds': [owner['id']],
    'operatingDetected': True, 'photos': ['/uploads/demo-g-sneak.jpg'],
    'reboundNotes': '复查发现快餐店夜间重新开张，何大勇搬回'})
check('G-偷返复查成功(同档案重开)', st in (200, 201), str(d)[:80])
arc_g = req('GET', f"/houses/{gid}/archive", county)[1]
check('G-偷返后状态反弹(同一条档案)', house_by_code('NF-QS-000007', county)['id'] == gid and arc_g['house']['status'] == 'REBOUND')
check('G-旧销号已作废', len(arc_g['closes']) == 1 and arc_g['closes'][0]['invalidated'] is True and arc_g['close'] is None)
check('G-偷返人员标记为擅自返回', any(p['evacStatus'] == 'SNEAK_BACK' for p in arc_g['evacPersons']))
check('G-偷返生成阻断异常', any(i['type'] == 'SNEAK_RETURN' and i['blocksWorkflow'] for p in [0] for i in arc_g['issues']))
check('G-作废后拨付整改补助被拒', req('POST', f"/subsidies/{g_sub['id']}/pay", county)[0] == 400)
check('G-作废后复营业核准失效/禁止新申请', req('POST', f"/houses/{gid}/resumptions", farmer3,
    {'businessName': '何家快餐店', 'applicantName': '何大勇'})[0] == 400)
check('G-作废后房屋清退标记回退', arc_g['house']['evictionCleared'] is False)

# 同一事件再次处置：劝返安置→办结偷返异常→重新复核→二次销号（不新建记录）
st, d = req('POST', f"/evacuation-persons/{owner['id']}/verify", grid3, {
    'evacStatus': 'RELOCATED', 'destination': '青山镇集中安置点', 'settledFrom': '2026-11-20',
    'photos': ['/uploads/demo-g-re-evac.jpg'], 'remark': '再次劝离至安置点'})
check('G-偷返人员再次劝离可重新核对', st in (200, 201) and d['rollup']['cleared'] is True)
sneak_issue = [i for i in req('GET', f"/houses/{gid}/archive", county)[1]['issues'] if i['type'] == 'SNEAK_RETURN'][0]
req('POST', f"/issues/{sneak_issue['id']}/status", town3,
    {'status': 'RESOLVED', 'resolution': '再次劝离并安置，约谈经营者，加密巡查'})
insp_g = req('GET', f"/houses/{gid}/archive", county)[1]['inspections'][0]
st, d = req('POST', '/reviews', town3, {
    'inspectionId': insp_g['id'], 'decision': 'EVACUATE', 'deadline': '2026-12-10',
    'items': [{'type': 'SET_WARNING', 'description': '加固后补充警示与监测'},
              {'type': 'TEMP_RESETTLEMENT', 'description': '维持安置至复查安全'}]})
check('G-原事件允许重新复核', st in (200, 201))
g_plan2 = d
req('POST', '/notices', grid3, {'houseId': gid, 'method': '现场告知', 'notifiedTo': ['何大勇'], 'acknowledged': True})
for it in g_plan2['items']:
    req('POST', f"/rectification-items/{it['id']}/status", town3, {'status': 'DONE'})
g2_items = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in g_plan2['items']]
req('POST', '/acceptances', acceptor, {'houseId': gid, 'itemResults': g2_items, 'comment': '二次验收合格'})
st, d = req('POST', '/closes', county, {'houseId': gid, 'confirmedAllItems': True, 'confirmedStopUseLifted': True})
check('G-允许二次销号(同档案)', st in (200, 201))
arc_g = req('GET', f"/houses/{gid}/archive", county)[1]
check('G-保留两次销号且最新有效', len(arc_g['closes']) == 2 and arc_g['closes'][0]['invalidated'] is False)
check('G-二次销号后可再次申请复营业', req('POST', f"/houses/{gid}/resumptions", farmer3,
    {'businessName': '何家快餐店', 'applicantName': '何大勇', 'applyReason': '二次销号后申请'})[0] in (200, 201))
# 二次销号后对复营业申请重新核准（原核准随旧销号失效）
g_res = req('GET', f"/houses/{gid}/archive", county)[1]['resumptions']
g_res_applied = [r for r in g_res if r['status'] == 'APPLIED']
if g_res_applied:
    st, d = req('POST', f"/resumptions/{g_res_applied[0]['id']}/review", town3,
                {'approved': True, 'resumeFrom': '2026-12-01', 'comment': '二次销号，现场安全，同意复业'})
    check('G-二次销号后重新核准复营业', st in (200, 201) and d['resumeFrom'] == '2026-12-01')

# ---------- H房屋：已销号后偷返，旧销号作废（种子预置）----------
h, arc_h = archive('NF-YL-000008')
check('H-偷返后为反弹状态', h['status'] == 'REBOUND')
check('H-旧销号已作废', len(arc_h['closes']) == 1 and arc_h['closes'][0]['invalidated'] is True and arc_h['close'] is None)
check('H-1人偷返3人安全返回', arc_h['evacRollup']['sneakBack'] == 1 and arc_h['evacRollup']['returned'] == 3)
check('H-补助虽已批准但拨付被旧销号作废拦截',
      req('POST', f"/subsidies/{arc_h['subsidy']['id']}/pay", county)[0] == 400)
check('H-偷返阻断异常存在', any(i['type'] == 'SNEAK_RETURN' and i['blocksWorkflow'] for i in arc_h['issues']))
check('H-复查记录带偷返标记', arc_h['rechecks'][0]['sneakReturn'] is True and len(arc_h['rechecks'][0]['sneakPersonIds']) == 1)
# 整改期间（反弹状态无有效销号）再次偷返复查：接着原事件处理，不报错、不另建销号
sneak2 = [p for p in arc_h['evacPersons'] if p['evacStatus'] != 'SNEAK_BACK'][:1]
st, d = req('POST', '/rechecks', grid3, {'houseId': h['id'], 'result': 'FAIL', 'sneakReturn': True,
                                        'personIds': [sneak2[0]['id']], 'reboundNotes': '又一人夜间返回'})
check('H-反弹期间再次偷返复查仍走原事件', st in (200, 201))
arc_h2 = req('GET', f"/houses/{h['id']}/archive", county)[1]
check('H-仍是同一条销号记录且已作废', len(arc_h2['closes']) == 1 and arc_h2['closes'][0]['invalidated'] is True)
check('H-累计2人偷返', arc_h2['evacRollup']['sneakBack'] == 2)

# ---------- 驾驶舱：清退口径与安置补助监督 ----------
_, dash = req('GET', '/dashboard', county)
evs = dash['evacuationSummary']
check('DB-须转移房屋≥3', evs['requiredHouses'] >= 3, str(evs)[:100])
partial_codes = [x['code'] for x in evs['partialEvacHouses']]
check('DB-H栋出现在未全员清退督办清单', 'NF-YL-000008' in partial_codes, str(partial_codes))
check('DB-已闭环的A/G不在未清退清单', 'NF-XK-000001' not in partial_codes and 'NF-QS-000007' not in partial_codes)
check('DB-偷返人数统计≥2', evs['personsSneakBack'] >= 2, str(evs['personsSneakBack']))
check('DB-安置补助有拨付记录', dash['aidSummary']['paid'] >= 1 and dash['aidSummary']['paidAmount'] >= 3000, str(dash['aidSummary']))
check('DB-经营损失/复营业已统计', dash['businessSummary']['lossVerified'] >= 1 and dash['businessSummary']['resumptionApproved'] >= 1, str(dash['businessSummary']))
check('DB-异常类型含偷返', 'SNEAK_RETURN' in dash['issuesByType'])

# ---------- 角色越权 ----------
st, d = req('POST', '/inspections', farmer2, {
    'township': '云岭乡', 'village': 'x', 'address': 'x', 'ownerName': 'x',
    'buildYear': 2000, 'floors': 1})
check('权限-农户不能登记巡查', st == 403)
st, d = req('POST', '/closes', town1, {'houseId': a['id'], 'confirmedAllItems': True,
                                       'confirmedStopUseLifted': True})
check('权限-乡镇不能销号', st == 403)
st, _ = req('POST', f"/houses/{gid}/aids", acceptor, {'personDays': 10})
check('权限-验收员不能申请安置补助', st == 403)

# ---------- 无Token ----------
st, d = req('GET', '/houses')
check('权限-未登录被拒', st == 401)

print()
print('FAILED:', fails if fails else 'NONE')
