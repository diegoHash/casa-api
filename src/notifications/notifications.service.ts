import { Injectable } from '@nestjs/common';
import { PayableStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPayableNotifications(communityId: string) {
    const now = new Date();
    const dueSoonUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const openWhere = { communityId, status: { in: [PayableStatus.PENDING, PayableStatus.PARTIALLY_PAID] } };
    const [openPayables, duePayables, reminders] = await Promise.all([
      this.prisma.vendorPayable.findMany({ where: openWhere, select: { amount: true, amountPaid: true, currency: true } }),
      this.prisma.vendorPayable.findMany({
        where: { ...openWhere, dueDate: { lte: dueSoonUntil } },
        orderBy: { dueDate: 'asc' },
        take: 25,
        select: { id: true, supplierName: true, description: true, dueDate: true, amount: true, amountPaid: true, currency: true },
      }),
      this.prisma.payableReminder.findMany({
        where: { communityId, status: 'ACTIVE', remindAt: { lte: now }, payable: { status: { in: [PayableStatus.PENDING, PayableStatus.PARTIALLY_PAID] } } },
        orderBy: { remindAt: 'asc' },
        take: 25,
        include: { payable: { select: { id: true, supplierName: true, description: true, status: true } } },
      }),
    ]);

    const totals = new Map<string, Prisma.Decimal>();
    for (const payable of openPayables) {
      const pending = payable.amount.minus(payable.amountPaid);
      totals.set(payable.currency, (totals.get(payable.currency) ?? new Prisma.Decimal(0)).plus(pending));
    }

    const items: Array<{
      id: string;
      kind: 'PAYABLE_SUMMARY' | 'PAYABLE_DUE' | 'PAYABLE_REMINDER';
      severity: 'INFO' | 'WARNING' | 'URGENT';
      title: string;
      message: string;
      createdAt: string;
      payableId?: string;
      reminderId?: string;
    }> = [];
    if (openPayables.length) {
      const totalText = Array.from(totals.entries()).map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`).join(' · ');
      items.push({ id: `payables-summary-${communityId}`, kind: 'PAYABLE_SUMMARY', severity: 'INFO', title: `Tienes ${openPayables.length} cuentas por pagar pendientes`, message: `Saldo pendiente total: ${totalText}.`, createdAt: now.toISOString() });
    }
    for (const payable of duePayables) {
      const pending = payable.amount.minus(payable.amountPaid);
      const overdue = payable.dueDate.getTime() < now.getTime();
      items.push({
        id: `payable-due-${payable.id}-${payable.dueDate.toISOString().slice(0, 10)}`,
        kind: 'PAYABLE_DUE',
        severity: overdue ? 'URGENT' : 'WARNING',
        title: overdue ? 'Cuenta por pagar vencida' : 'Cuenta por pagar próxima a vencer',
        message: `${payable.supplierName}: ${payable.description}. ${overdue ? 'Venció' : 'Vence'} el ${payable.dueDate.toLocaleDateString('es-VE')} · saldo ${payable.currency} ${pending.toFixed(2)}.`,
        createdAt: payable.dueDate.toISOString(),
        payableId: payable.id,
      });
    }
    for (const reminder of reminders) {
      items.push({
        id: `payable-reminder-${reminder.id}`,
        kind: 'PAYABLE_REMINDER',
        severity: 'WARNING',
        title: 'Recordatorio de cuenta por pagar',
        message: reminder.message?.trim() || `Recuerda revisar y pagar ${reminder.payable.supplierName}: ${reminder.payable.description}.`,
        createdAt: reminder.remindAt.toISOString(),
        payableId: reminder.payableId,
        reminderId: reminder.id,
      });
    }
    return { generatedAt: now.toISOString(), unreadCount: items.length, items };
  }
}
