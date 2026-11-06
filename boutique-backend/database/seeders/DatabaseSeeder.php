<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\Video;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        User::updateOrCreate(
            ['email' => 'sa@gmail.com'],
            [
                'name' => 'Yaale Admin',
                'password' => Hash::make('12345678'),
                'is_admin' => true,
            ]
        );

        User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
        ]);

        $videoSeeds = [
            [
                'title' => 'Festival Silk Story',
                'video' => 'https://player.vimeo.com/external/449802739.sd.mp4?s=4906e1d2d742d68ec5f2f8f7e73f5b87d8d9d9d&profile_id=164&oauth2_token_id=57447761',
                'poster' => 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1200&h=1800&fit=crop&auto=format',
            ],
            [
                'title' => 'Morning Weave Ritual',
                'video' => 'https://player.vimeo.com/external/449802739.sd.mp4?s=4906e1d2d742d68ec5f2f8f7e73f5b87d8d9d9d&profile_id=164&oauth2_token_id=57447761',
                'poster' => 'https://images.unsplash.com/photo-1597897569252-9df44c7de0db?w=1200&h=1800&fit=crop&auto=format',
            ],
        ];

        foreach ($videoSeeds as $videoData) {
            Video::updateOrCreate(
                ['title' => $videoData['title']],
                [
                    'video' => $videoData['video'],
                    'poster' => $videoData['poster'],
                    'is_active' => true,
                ]
            );
        }
    }
}
