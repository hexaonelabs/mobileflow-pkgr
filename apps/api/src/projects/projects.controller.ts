import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BuildsService } from '../builds/builds.service';
import { CreateBuildDto } from '../builds/dto/create-build.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly buildsService: BuildsService,
  ) {}

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.projectsService.findAllForUser(req.user.id);
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.projectsService.findOneOwned(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.projectsService.remove(req.user.id, id);
  }

  @Post(':id/builds')
  createBuild(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateBuildDto,
  ) {
    return this.buildsService.create(req.user.id, id, dto);
  }

  @Get(':id/builds')
  listBuilds(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.buildsService.findAllForProject(req.user.id, id);
  }
}
