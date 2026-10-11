import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { resolveCommunityWorkspaceCodes } from "./workspace-catalog";
import { AccessStatus } from "@prisma/client";
import { Request } from "express";
import { PrismaService } from "../database/prisma.service";
import { AuthPrincipal } from "./auth.types";
import { TokenService } from "./token.service";

type AuthenticatedRequest = Request & { auth?: AuthPrincipal; communityName?: string };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Falta el token de acceso.");
    }

    const payload = this.tokens.verifyAccessToken(authorization.slice(7));
    const user = await this.prisma.appUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        platformRole: true,
        status: true,
        tokenVersion: true,
      },
    });
    if (
      !user ||
      user.status !== AccessStatus.ACTIVE ||
      user.tokenVersion !== payload.tokenVersion
    ) {
      throw new UnauthorizedException(
        "La sesión ya no es válida para este usuario.",
      );
    }

    let communityRole = payload.communityRole;
    let scopes = payload.scopes ?? [];
    let workspaces = payload.workspaces ?? [];

    // Claims are only a routing hint. Authorization is rebuilt from the
    // current community access on every request so revocations and scope
    // changes take effect immediately, without waiting for JWT expiration.
    if (payload.communityId && user.platformRole !== "ROOT") {
      const now = new Date();
      const access = await this.prisma.communityAccess.findFirst({
        where: {
          userId: user.id,
          communityId: payload.communityId,
          status: AccessStatus.ACTIVE,
          startsOn: { lte: now },
          OR: [{ endsOn: null }, { endsOn: { gt: now } }],
        },
        select: {
          roleCode: true,
          scopes: true,
          workspaces: {
            where: {
              status: "ACTIVE",
              startsOn: { lte: now },
              OR: [{ endsOn: null }, { endsOn: { gt: now } }],
            },
            select: { workspaceCode: true },
          },
        },
      });
      communityRole = access?.roleCode;
      request.communityName = (await this.prisma.community.findUnique({ where: { id: payload.communityId }, select: { name: true } }))?.name;
      scopes = Array.isArray(access?.scopes)
        ? access.scopes.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : [];
      workspaces = access
        ? resolveCommunityWorkspaceCodes(access.workspaces, scopes)
        : [];
    }

    request.auth = {
      userId: user.id,
      email: user.email,
      platformRole: user.platformRole,
      tokenVersion: user.tokenVersion,
      communityId: payload.communityId,
      communityName: request.communityName,
      communityRole,
      scopes,
      workspaces,
    };
    return true;
  }
}
