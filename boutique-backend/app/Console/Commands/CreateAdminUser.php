<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class CreateAdminUser extends Command
{
    protected $signature = 'admin:create {email?}';

    protected $description = 'Create an administrator account or promote an existing user';

    public function handle(): int
    {
        $email = $this->argument('email') ?: $this->ask('Administrator email');

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Enter a valid email address.');

            return self::FAILURE;
        }

        $user = User::query()->where('email', $email)->first();

        if ($user) {
            if ($user->is_admin) {
                $this->info('This account is already an administrator.');

                return self::SUCCESS;
            }

            $user->is_admin = true;
            $user->save();
            $this->info('Existing account promoted to administrator. Its password was not changed.');

            return self::SUCCESS;
        }

        $name = $this->ask('Administrator name');
        $password = $this->secret('Administrator password (at least 12 characters)');
        $confirmation = $this->secret('Confirm administrator password');

        if (! is_string($name) || trim($name) === '' || ! is_string($password) || strlen($password) < 12 || $password !== $confirmation) {
            $this->error('A name, matching password confirmation, and password of at least 12 characters are required.');

            return self::FAILURE;
        }

        $user = new User();
        $user->name = trim($name);
        $user->email = $email;
        $user->password = $password;
        $user->is_admin = true;
        $user->save();

        $this->info('Administrator account created.');

        return self::SUCCESS;
    }
}