import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { AccountingService } from './accounting.service';
import {
  CreateAccountingPeriodDto,
  CreateJournalEntryDto,
  CreateLedgerAccountDto,
  ReverseJournalEntryDto,
  UpdateLedgerAccountDto,
} from './dto/accounting.dto';

@Controller('accounting')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('snapshot')
  @RequireScopes('accounting.read')
  snapshot(@CurrentAuth() auth: AuthPrincipal) {
    return this.accounting.snapshot(auth.communityId as string);
  }

  @Post('accounts')
  @RequireScopes('accounting.write')
  createAccount(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateLedgerAccountDto,
  ) {
    return this.accounting.createAccount(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Patch('accounts/:id')
  @RequireScopes('accounting.write')
  updateAccount(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateLedgerAccountDto,
  ) {
    return this.accounting.updateAccount(
      auth.communityId as string,
      auth.userId,
      id,
      input,
    );
  }

  @Post('periods')
  @RequireScopes('accounting.write')
  createPeriod(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateAccountingPeriodDto,
  ) {
    return this.accounting.createPeriod(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Post('entries')
  @RequireScopes('accounting.write')
  createEntry(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateJournalEntryDto,
  ) {
    return this.accounting.createEntry(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Post('entries/:entryId/post')
  @RequireScopes('accounting.post')
  postEntry(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('entryId') entryId: string,
  ) {
    return this.accounting.postEntry(
      auth.communityId as string,
      auth.userId,
      entryId,
    );
  }

  @Post('entries/:entryId/reverse')
  @RequireScopes('accounting.post')
  reverseEntry(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('entryId') entryId: string,
    @Body() input: ReverseJournalEntryDto,
  ) {
    return this.accounting.reverseEntry(
      auth.communityId as string,
      auth.userId,
      entryId,
      input,
    );
  }

  @Post('periods/:periodId/close')
  @RequireScopes('accounting.post')
  closePeriod(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('periodId') periodId: string,
  ) {
    return this.accounting.closePeriod(
      auth.communityId as string,
      auth.userId,
      periodId,
    );
  }
}
