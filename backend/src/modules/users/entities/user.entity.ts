export class UserEntity {
  id!: string;
  email!: string | null;
  username!: string;
  role!: 'free' | 'premium' | 'moderator' | 'admin';
  createdAt!: Date;
  updatedAt!: Date;
}
