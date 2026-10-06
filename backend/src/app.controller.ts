import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AuthGuard, Roles } from './auth.guard';
import { AppService, CurrentUser } from './app.service';
import { UserRole, ItemStatus, IssueStatus } from './entities';

const ALL_STAFF = [
  UserRole.GRID_WORKER,
  UserRole.TOWNSHIP_REVIEWER,
  UserRole.COUNTY_ADMIN,
  UserRole.FARMER,
  UserRole.TEAM,
  UserRole.ACCEPTOR,
];

@Controller('api')
@UseGuards(AuthGuard)
export class AppController {
  constructor(private readonly svc: AppService) {}

  // ---------- 房屋档案 ----------
  @Get('houses')
  listHouses(@Query() q: any, @Req() req: any) {
    return this.svc.listHouses(q, req.user as CurrentUser);
  }

  @Get('houses/:id/archive')
  archive(@Param('id') id: string) {
    return this.svc.houseArchive(id);
  }

  // ---------- 巡查（网格员）----------
  @Post('inspections')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  createInspection(@Body() body: any, @Req() req: any) {
    return this.svc.createInspection(req.user, body);
  }

  // ---------- 复核方案（乡镇住建）----------
  @Post('reviews')
  @Roles(UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  createReview(@Body() body: any, @Req() req: any) {
    return this.svc.createReview(req.user, body);
  }

  // ---------- 告知 / 停用 / 转移 ----------
  @Post('notices')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  createNotice(@Body() body: any, @Req() req: any) {
    return this.svc.createNotice(req.user, body);
  }

  @Post('houses/:id/stop-use')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  stopUse(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.confirmStopUse(req.user, id, body || {});
  }

  @Post('evacuations')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  createEvacuation(@Body() body: any, @Req() req: any) {
    return this.svc.createEvacuation(req.user, body);
  }

  // ---------- 人员转移花名册（逐人现场核对）----------
  @Post('houses/:id/evacuation-roster')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  initRoster(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.initPersonRoster(req.user, id, body || {});
  }

  @Post('evacuation-persons/:pid/verify')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  verifyPerson(@Param('pid') pid: string, @Body() body: any, @Req() req: any) {
    return this.svc.verifyPerson(req.user, pid, body);
  }

  @Delete('evacuation-persons/:pid')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  deletePerson(@Param('pid') pid: string, @Req() req: any) {
    return this.svc.deletePerson(req.user, pid);
  }

  // ---------- 安置补助 ----------
  @Post('houses/:id/aids')
  @Roles(UserRole.FARMER, UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  submitAid(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.submitAid(req.user, id, body || {});
  }

  @Post('aids/:aidId/review')
  @Roles(UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  reviewAid(@Param('aidId') aidId: string, @Body() body: any, @Req() req: any) {
    return this.svc.reviewAid(req.user, aidId, body);
  }

  @Post('aids/:aidId/pay')
  @Roles(UserRole.COUNTY_ADMIN)
  payAid(@Param('aidId') aidId: string, @Req() req: any) {
    return this.svc.payAid(req.user, aidId);
  }

  // ---------- 经营损失 ----------
  @Post('houses/:id/business-losses')
  @Roles(UserRole.FARMER, UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  submitLoss(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.submitLoss(req.user, id, body || {});
  }

  @Post('business-losses/:lossId/review')
  @Roles(UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  reviewLoss(@Param('lossId') lossId: string, @Body() body: any, @Req() req: any) {
    return this.svc.reviewLoss(req.user, lossId, body);
  }

  // ---------- 复营业核准 ----------
  @Post('houses/:id/resumptions')
  @Roles(UserRole.FARMER, UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  applyResumption(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.applyResumption(req.user, id, body || {});
  }

  @Post('resumptions/:rid/review')
  @Roles(UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  reviewResumption(@Param('rid') rid: string, @Body() body: any, @Req() req: any) {
    return this.svc.reviewResumption(req.user, rid, body);
  }

  // ---------- 利益相关方 / 协商 / 异常 ----------
  @Post('houses/:id/stakeholders')
  @Roles(...ALL_STAFF)
  upsertStakeholder(@Param('id') id: string, @Body() body: any) {
    return this.svc.upsertStakeholder(id, body);
  }

  @Post('consultations')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  consultation(@Body() body: any, @Req() req: any) {
    return this.svc.createConsultation(req.user, body);
  }

  @Post('issues')
  @Roles(...ALL_STAFF)
  raiseIssue(@Body() body: any, @Req() req: any) {
    return this.svc.raiseIssue(req.user, body);
  }

  @Post('issues/:id/status')
  @Roles(UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  setIssueStatus(@Param('id') id: string, @Body() body: { status: IssueStatus; resolution?: string }, @Req() req: any) {
    return this.svc.setIssueStatus(req.user, id, body.status, body.resolution);
  }

  // ---------- 家庭情况与权属 ----------
  @Post('houses/:id/family')
  @Roles(UserRole.FARMER, UserRole.GRID_WORKER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  upsertFamily(@Param('id') id: string, @Body() body: any) {
    return this.svc.upsertFamily(id, body);
  }

  // ---------- 施工队 ----------
  @Get('teams')
  listTeams() {
    return this.svc.listTeams();
  }

  @Post('teams')
  @Roles(UserRole.COUNTY_ADMIN, UserRole.TOWNSHIP_REVIEWER)
  createTeam(@Body() body: any) {
    return this.svc.createTeam(body);
  }

  // ---------- 施工计划 ----------
  @Post('construction-plans')
  @Roles(UserRole.FARMER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  submitPlan(@Body() body: any, @Req() req: any) {
    return this.svc.submitConstructionPlan(req.user, body);
  }

  @Post('construction-logs')
  @Roles(UserRole.TEAM, UserRole.TOWNSHIP_REVIEWER, UserRole.GRID_WORKER, UserRole.COUNTY_ADMIN)
  addLog(@Body() body: any, @Req() req: any) {
    return this.svc.addConstructionLog(req.user, body);
  }

  @Post('rectification-items/:id/status')
  @Roles(UserRole.TOWNSHIP_REVIEWER, UserRole.ACCEPTOR, UserRole.COUNTY_ADMIN)
  setItemStatus(@Param('id') id: string, @Body() body: { status: ItemStatus }, @Req() req: any) {
    return this.svc.setItemStatus(req.user, id, body.status);
  }

  // ---------- 补助 ----------
  @Get('houses/:id/subsidy-guards')
  subsidyGuards(@Param('id') id: string) {
    return this.svc.getHouseOrFail(id).then((h) => this.svc.computeSubsidyGuards(h));
  }

  @Post('houses/:id/subsidy')
  @Roles(UserRole.FARMER, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  submitSubsidy(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.submitSubsidy(req.user, id, body || {});
  }

  @Post('subsidies/:id/review')
  @Roles(UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  reviewSubsidy(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.reviewSubsidy(req.user, id, body);
  }

  @Post('subsidies/:id/pay')
  @Roles(UserRole.COUNTY_ADMIN)
  paySubsidy(@Param('id') id: string, @Req() req: any) {
    return this.svc.paySubsidy(req.user, id);
  }

  // ---------- 验收 ----------
  @Post('acceptances')
  @Roles(UserRole.ACCEPTOR, UserRole.TOWNSHIP_REVIEWER, UserRole.COUNTY_ADMIN)
  acceptance(@Body() body: any, @Req() req: any) {
    return this.svc.createAcceptance(req.user, body);
  }

  // ---------- 销号 / 复查 ----------
  @Post('closes')
  @Roles(UserRole.COUNTY_ADMIN)
  close(@Body() body: any, @Req() req: any) {
    return this.svc.closeHouse(req.user, body);
  }

  @Post('rechecks')
  @Roles(UserRole.GRID_WORKER, UserRole.COUNTY_ADMIN, UserRole.ACCEPTOR)
  recheck(@Body() body: any, @Req() req: any) {
    return this.svc.createRecheck(req.user, body);
  }

  // ---------- 县级驾驶舱 ----------
  @Get('dashboard')
  @Roles(UserRole.COUNTY_ADMIN, UserRole.TOWNSHIP_REVIEWER, UserRole.GRID_WORKER)
  dashboard(@Query() q: any, @Req() req: any) {
    return this.svc.dashboard(q, req.user as CurrentUser);
  }

  // ---------- 文件上传（材料、照片）----------
  @Post('upload')
  @Roles(...ALL_STAFF)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const suffix = extname(file.originalname) || '.jpg';
          cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${suffix}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(@UploadedFile() file: any) {
    return { url: `/uploads/${file.filename}`, name: file.originalname };
  }
}
