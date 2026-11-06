import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { looksLikeAutomatedTestUsername } from '../../common/automated-test';
import { PrismaService } from '../prisma/prisma.service';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    email?: string | null;
    username: string;
    passwordHash: string;
    countryCode?: string | null;
  }): Promise<UserEntity> {
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            ...(input.email !== undefined ? { email: input.email } : {}),
            username: input.username,
            passwordHash: input.passwordHash,
            countryCode: input.countryCode
              ? String(input.countryCode).toUpperCase().slice(0, 2)
              : null,
            isAutomatedTest: looksLikeAutomatedTestUsername(input.username)
          }
        });
        await tx.wallet.create({
          data: { userId: createdUser.id }
        });
        return createdUser;
      });
      return this.toEntity(user);
    } catch (error: unknown) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('email or username already in use');
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findById(id: string): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return this.toEntity(user);
  }

  private toEntity(user: User): UserEntity {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }
}
