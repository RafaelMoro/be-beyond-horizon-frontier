export class UserCreatedDto {
  email: string;
  sub: string;
}

export class UserUpdatedDto {
  email: string;
  firstName: string;
  middleName: string;
  lastName: string;
}

export class UserDeletedDto {
  email: string;
  firstName: string;
  lastName: string;
}
