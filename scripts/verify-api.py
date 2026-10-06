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
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

def login(u):
    _, d = req('POST', '/auth/login', data={'username': u, 'password': '123456'})
    return d['token']

county = login('county1'); town1 = login('town1'); town2 = login('town2')
town3 = login('town3'); grid1 = login('grid1'); grid3 = login('grid3')
grid2 = login('grid2'); acceptor = login('acceptor1'); farmer2 = login('farmer2'); team = login('team1')
fails = []
def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), name, detail)
    if not cond: fails.append(name)

def house_by_code(code, token):
    _, d = req('GET', '/houses?q=' + code, token)
    return d['data'][0]

# ---------- B房屋：偷换材料阻断验收 ----------
b = house_by_code('NF-YL-000002', county)
arc_b = req('GET', f"/houses/{b['id']}/archive", county)[1]
plan_b = arc_b['plans'][0]
blocking = [i['type'] for i in arc_b['blockingIssues']]
check('B-偷换材料生成阻断异常', 'MATERIAL_SWAP' in blocking, str(blocking))

# 未解决材料问题前组织验收 -> 拒绝
results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_b['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': b['id'], 'itemResults': results})
check('B-阻断异常未办结禁止验收', st == 400, d.get('message', '')[:60])

# 无资质施工队不能被选择（尝试用不存在/失效队伍由乡镇创建后提交）
_, teams = req('GET', '/teams', county)[0], None
_, teamlist = req('GET', '/teams', county)
bad_team = [t for t in teamlist if not t['qualified']][0]
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': b['id'], 'teamId': bad_team['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-01',
    'budgetItems': [{'name': '防水卷材', 'spec': 'SBS 4mm', 'qty': 10, 'unit': '㎡', 'unitPrice': 45}]})
check('B-阻断异常时连提交计划也被拦截', st == 400 and '阻断' in d['message'], d.get('message', '')[:60])

# 办结材料问题（要求填写处置结果）
swap = arc_b['issues'][0]
st, d = req('POST', f"/issues/{swap['id']}/status", town2, {'status': 'RESOLVED'})
check('B-办结问题必须填处置结果', st == 400)
st, d = req('POST', f"/issues/{swap['id']}/status", town2,
            {'status': 'RESOLVED', 'resolution': '清退非标卷材，更换为SBS 4mm合格材料并复验'})
check('B-问题可办结', st == 201 or st == 200)

# 补助已批准但未销号 -> 禁止发放
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
# 已发补助不能重复发放
st, d = req('POST', f"/subsidies/{arc_a['subsidy']['id']}/pay", county)
check('A-补助不可重复发放', st == 400)

# ---------- E房屋：验收不通过自动生成阻断异常 ----------
e = house_by_code('NF-XK-000005', county)
arc_e = req('GET', f"/houses/{e['id']}/archive", county)[1]
check('E-验收不通过状态', e['status'] == 'ACCEPTANCE_FAILED')
check('E-验收失败阻断异常', any(i['type'] == 'ACCEPTANCE_FAIL' and i['blocksWorkflow'] for i in arc_e['issues']))
# 未处置前再次验收 -> 拒绝
plan_e = arc_e['plans'][0]
results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_e['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': e['id'], 'itemResults': results})
check('E-阻断异常未办结不能重新验收', st == 400 and '阻断' in d['message'], d.get('message', '')[:50])

# ---------- F房屋：复查反弹后重新治理并再次销号 ----------
f = house_by_code('NF-QS-000006', county)
arc_f = req('GET', f"/houses/{f['id']}/archive", county)[1]
check('F-反弹状态', f['status'] == 'REBOUND')
# 办结反弹问题 + 重新复核
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

# ---------- 角色越权 ----------
st, d = req('POST', '/inspections', farmer2, {
    'township': '云岭乡', 'village': 'x', 'address': 'x', 'ownerName': 'x',
    'buildYear': 2000, 'floors': 1})
check('权限-农户不能登记巡查', st == 403)
st, d = req('POST', '/closes', town1, {'houseId': a['id'], 'confirmedAllItems': True,
                                       'confirmedStopUseLifted': True})
check('权限-乡镇不能销号', st == 403)

# ---------- 无Token ----------
st, d = req('GET', '/houses')
check('权限-未登录被拒', st == 401)

# ---------- G房屋：人员转移清册化（6登5离不得清退）+ 整改期间偷返同事件续办 + 补助/复营业闸口 ----------
g = house_by_code('NF-YL-000007', county)
arc_g = req('GET', f"/houses/{g['id']}/archive", county)[1]
plan_g = arc_g['plans'][0]
roster0 = arc_g['roster']
check('G-登记6人仅5人离开状态为转移中', g['status'] == 'EVACUATING', g['status'])
check('G-清册聚合6登5离1在场1继续经营',
      roster0['registered'] == 6 and roster0['resettled'] == 5 and
      roster0['stillOnSite'] == 1 and roster0['continuingBusiness'] == 1 and roster0['full'] is False,
      str(roster0))
check('G-未全员清退生成督办异常(非阻断)',
      any(i['type'] == 'EVACUATION_INCOMPLETE' and not i['blocksWorkflow'] for i in arc_g['issues']))
# 已离开人员必须有安置点/起始日/照片
leaver = [p for p in arc_g['evacPersons'] if p['moveStatus'] == 'RESETTLED'][0]
check('G-离开人员有安置点/起始日/照片', bool(leaver['shelterName'] and leaver['settledFrom'] and leaver['photos']))
# 无照片/无安置点的核对被拒
st, d = req('POST', f"/evacuation-persons/{leaver['id']}/verify", grid2,
            {'moveStatus': 'RESETTLED', 'shelterName': 'x', 'settledFrom': '2026-10-01'})
check('G-现场核对无照片被拒', st == 400 and '照片' in d['message'], d.get('message', '')[:50])

# 开工/验收/销号/补助拨付全部停在对应环节
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': g['id'], 'teamId': [t for t in teamlist if t['qualified']][0]['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-10',
    'budgetItems': [{'name': '加固', 'qty': 1, 'unit': '项', 'unitPrice': 1000}]})
check('G-未全员清退禁止开工', st == 400 and '清退' in d['message'], d.get('message', '')[:60])
results_g = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_g['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': g['id'], 'itemResults': results_g})
check('G-未全员清退禁止验收', st == 400 and '清退' in d['message'], d.get('message', '')[:60])
st, d = req('POST', '/closes', county, {'houseId': g['id'], 'confirmedAllItems': True, 'confirmedStopUseLifted': True})
check('G-未全员清退禁止销号', st in (400, 403) )
approved_als = [a for a in arc_g['allowances'] if a['status'] == 'APPROVED']
check('G-补助申请保留且已核定2笔', len(approved_als) == 2, str([(a['type'], a['status']) for a in arc_g['allowances']]))
st, d = req('POST', f"/allowances/{approved_als[0]['id']}/pay", county)
check('G-未清退/未销号禁止拨付补助', st == 400 and '清退' in d['message'], d.get('message', '')[:60])

# 经营者周凯被劝离：6人全员现场确认离开
zk = [p for p in arc_g['evacPersons'] if '周凯' in p['name']][0]
st, d = req('POST', f"/evacuation-persons/{zk['id']}/verify", grid2, {
    'moveStatus': 'RESETTLED', 'shelterName': '大岭村集中安置点',
    'settledFrom': '2026-10-02', 'photos': ['/uploads/demo-g-zk-left.jpg'],
    'continueBusiness': False, 'remark': '经再次劝离，饭馆停业并入住安置点'})
check('G-6人全员核对后清册FULL', st in (200, 201) and d['summary']['full'] is True, str(d)[:80])
g2info = req('GET', f"/houses/{g['id']}/archive", county)[1]
check('G-全员清退后房屋状态EVACUATED', g2info['house']['status'] == 'EVACUATED', g2info['house']['status'])

# 提交施工计划（需户主同意书——种子已登记；阻断异常检查：EVACUATION_INCOMPLETE 非阻断不拦截）
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': g['id'], 'teamId': [t for t in teamlist if t['qualified']][0]['id'],
    'startDate': '2026-10-03', 'endDate': '2026-11-05',
    'budgetItems': [
        {'name': '加层拆除', 'spec': '', 'qty': 80, 'unit': '㎡', 'unitPrice': 120},
        {'name': '商品混凝土', 'spec': 'C30', 'qty': 10, 'unit': 'm³', 'unitPrice': 480},
    ]})
check('G-全员清退后允许开工', st in (200, 201), str(d)[:100])
for it in plan_g['items']:
    req('POST', f"/rectification-items/{it['id']}/status", town2, {'status': 'DONE'})

# 整改期间网格员复查：发现周凯偷偷回来继续经营 -> 同一事件续办
st, d = req('POST', '/rechecks/during', grid2, {
    'houseId': g['id'], 'foundReturn': True, 'foundOperating': True, 'foundOnSite': 1,
    'personIds': [zk['id']], 'photos': ['/uploads/demo-g-sneak.jpg'],
    'notes': '晚间复查发现饭馆开门营业，周凯在店内居住经营'})
check('G-偷返经营现场核查登记', st in (200, 201) and d.get('foundViolation') is True, str(d)[:80])
arc_g2 = req('GET', f"/houses/{g['id']}/archive", county)[1]
check('G-偷返后状态REBOUND(同事件续办)', arc_g2['house']['status'] == 'REBOUND', arc_g2['house']['status'])
check('G-生成偷返阻断异常', any(i['type'] == 'PERSON_RETURN' and i['blocksWorkflow'] for i in arc_g2['issues']))
check('G-清册人员被置为擅自返回',
      [p for p in arc_g2['evacPersons'] if p['id'] == zk['id']][0]['moveStatus'] == 'RETURNED')
# 偷返期间拨付/验收仍被拒
st, d = req('POST', '/acceptances', acceptor, {'houseId': g['id'], 'itemResults': results_g})
check('G-偷返续办期间禁止验收', st == 400)

# 未全员劝回时办结异常被拒
ret_issue = [i for i in arc_g2['issues'] if i['type'] == 'PERSON_RETURN' and i['status'] != 'RESOLVED'][0]
st, d = req('POST', f"/issues/{ret_issue['id']}/return-resolved", grid2,
            {'resolution': '已劝返', 'personIds': []})
check('G-未全员重新安置不得办结偷返', st == 400 and '重新安置' in d['message'], d.get('message', '')[:60])

# 再次现场核对：周凯重新离开安置，办结续办异常
st, d = req('POST', f"/issues/{ret_issue['id']}/return-resolved", grid2, {
    'resolution': '联合市监、公安再次劝离，周凯当晚回到安置点，饭馆重新封停，村委加强夜巡',
    'personIds': [zk['id']], 'shelterName': '大岭村集中安置点', 'settledFrom': '2026-10-06',
    'photos': ['/uploads/demo-g-zk-back.jpg']})
check('G-全员复核后可办结偷返', st in (200, 201), str(d)[:80])
arc_g3 = req('GET', f"/houses/{g['id']}/archive", county)[1]
check('G-办结后恢复EVACUATED(同一档案)', arc_g3['house']['status'] == 'EVACUATED', arc_g3['house']['status'])
# 房屋档案仍是同一栋（未新建记录）
same = req('GET', '/houses?q=NF-YL-000007', county)[1]['total']
check('G-复查续办未新建房屋记录', same == 1, str(same))

# 重新走验收→销号（同一事件第二轮）
st, d = req('POST', '/acceptances', acceptor, {'houseId': g['id'], 'itemResults': results_g, 'comment': '复核合格'})
check('G-二次验收通过', st in (200, 201), str(d)[:80])
st, d = req('POST', '/closes', county, {'houseId': g['id'], 'confirmedAllItems': True, 'confirmedStopUseLifted': True})
check('G-二次销号通过', st in (200, 201), str(d)[:80])

# 销号后偷返复查（现场核查撤销已有效销号；旧销号不得继续有效）
req('POST', '/rechecks/during', grid2, {
    'houseId': g['id'], 'foundReturn': True, 'personIds': [zk['id']],
    'photos': ['/uploads/demo-g-sneak2.jpg'], 'notes': '销号后又擅自返回经营'})
arc_g4 = req('GET', f"/houses/{g['id']}/archive", county)[1]
check('G-销号后偷返旧销号被撤销', arc_g4['closeValid'] is False and arc_g4['close']['revoked'] is True)
st, d = req('POST', f"/allowances/{approved_als[0]['id']}/pay", county)
check('G-旧销号撤销后补助停拨', st == 400, d.get('message', '')[:60])
st, d = req('POST', f"/houses/{g['id']}/resume-business", town2, {})
check('G-销号无效禁止复营业', st == 400 and '销号' in d['message'], d.get('message', '')[:60])
# 劝返→办结→重新验收销号
ret_issue2 = [i for i in req('GET', f"/houses/{g['id']}/archive", county)[1]['issues']
              if i['type'] == 'PERSON_RETURN' and i['status'] != 'RESOLVED'][0]
req('POST', f"/issues/{ret_issue2['id']}/return-resolved", grid2, {
    'resolution': '再次劝返安置点，批评教育，恢复封停', 'personIds': [zk['id']],
    'shelterName': '大岭村集中安置点', 'settledFrom': '2026-10-07', 'photos': ['/uploads/demo-g-zk-back2.jpg']})
st, d = req('POST', '/acceptances', acceptor, {'houseId': g['id'], 'itemResults': results_g, 'comment': '再次复核合格'})
check('G-续办后再次验收', st in (200, 201), str(d)[:80])
st, d = req('POST', '/closes', county, {'houseId': g['id'], 'confirmedAllItems': True, 'confirmedStopUseLifted': True})
check('G-续办后再次销号', st in (200, 201), str(d)[:80])
# 有效销号 + 全员清退：补助可拨付、复营业须单独准许
st, d = req('POST', f"/allowances/{approved_als[0]['id']}/pay", county)
check('G-销号有效后补助允许拨付', st in (200, 201), str(d)[:80])
st, d = req('POST', f"/allowances/{approved_als[1]['id']}/pay", county)
check('G-经营损失补助允许拨付', st in (200, 201), str(d)[:80])
arc_g5 = req('GET', f"/houses/{g['id']}/archive", county)[1]
check('G-销号后尚未准许复营业', arc_g5['house']['resumeBusinessApproved'] is False)
st, d = req('POST', f"/houses/{g['id']}/resume-business", town2, {'condition': '限一楼经营，每月巡查一次'})
check('G-有效销号后准许复营业', st in (200, 201), str(d)[:80])
st, d = req('POST', f"/houses/{g['id']}/resume-business", town2, {})
check('G-复营业准许不可重复', st == 400)

# 驾驶舱新增统计可读且数值合理
db = req('GET', '/dashboard', county)[1]
check('DASH-清册统计6登6离(G)计入', db['evacuation']['personsRegistered'] >= 6 and db['evacuation']['housesFullyCleared'] >= 1, str(db['evacuation']))
check('DASH-安置/经营补助已拨付2笔', db['allowanceSummary']['paid'] >= 2, str(db['allowanceSummary']))

print()
print('FAILED:', fails if fails else 'NONE')
