export class UserProfileDto {
  id!: string;
  email!: string | null;
  username!: string;
  role!: 'free' | 'premium';
  createdAt!: Date;
}
