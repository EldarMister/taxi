import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthGuard, AuthService, RateLimits } from './auth';
import { AppConfig } from './config';
import { DriverService } from './driver';
import { RealtimeEvents } from './events';
import { TaxiGateway } from './gateway';
import { AdminController, AuthController, DriverController, OrdersController, PublicController, UsersController } from './http';
import { BackgroundJobs } from './jobs';
import { OrdersService } from './orders';
import { PrismaService } from './prisma.service';
import { PushService, RoutingService } from './providers';
import { PlacesController, PlacesService } from './places';
@Module({imports:[JwtModule.register({}),ScheduleModule.forRoot()],controllers:[AuthController,UsersController,OrdersController,DriverController,AdminController,PublicController,PlacesController],providers:[PrismaService,AppConfig,AuthService,AuthGuard,RateLimits,RoutingService,PushService,RealtimeEvents,OrdersService,DriverService,TaxiGateway,BackgroundJobs,PlacesService]})
export class AppModule {}
