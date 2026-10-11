import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface MonitoringErrorNotice {
  id: string; occurredAt: string; statusCode: number; method: string; path: string;
  message: string; stack: string | null; stackTruncated: boolean; requestId: string;
  ipAddress: string | null; userId: string | null; userEmail: string | null;
  communityId: string | null; communityName: string | null;
}

@Injectable()
export class MonitoringEvents {
  private readonly subject = new Subject<MonitoringErrorNotice>();
  readonly errors$ = this.subject.asObservable();
  publish(error: MonitoringErrorNotice) { this.subject.next(error); }
}
