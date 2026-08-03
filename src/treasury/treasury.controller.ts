import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import {
  CreateBankAccountDto,
  CreatePaymentMethodDto,
  UpdateBankAccountDto,
  UpdatePaymentMethodDto,
} from './dto/treasury.dto';
import { TreasuryService } from './treasury.service';

@Controller('treasury')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get('snapshot')
  @RequireScopes('treasury.read')
  snapshot(@CurrentAuth() auth: AuthPrincipal) {
    return this.treasury.snapshot(auth.communityId as string);
  }

  @Post('bank-accounts')
  @RequireScopes('treasury.write')
  createBankAccount(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateBankAccountDto,
  ) {
    return this.treasury.createBankAccount(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Patch('bank-accounts/:id')
  @RequireScopes('treasury.banks.write')
  updateBankAccount(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateBankAccountDto,
  ) {
    return this.treasury.updateBankAccount(
      auth.communityId as string,
      id,
      auth.userId,
      input,
    );
  }

  @Post('payment-methods')
  @RequireScopes('treasury.write')
  createPaymentMethod(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreatePaymentMethodDto,
  ) {
    return this.treasury.createPaymentMethod(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Patch('payment-methods/:id')
  @RequireScopes('treasury.methods.write')
  updatePaymentMethod(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdatePaymentMethodDto,
  ) {
    return this.treasury.updatePaymentMethod(
      auth.communityId as string,
      id,
      auth.userId,
      input,
    );
  }
}
