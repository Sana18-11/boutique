<?php

namespace App\Http\Controllers;

use App\Models\Video;
use Illuminate\Http\Request;

class VideoController extends Controller
{
    public function index()
    {
        $videos = Video::where('is_active', true)
            ->latest()
            ->get();

        if ($videos->isEmpty()) {
            return response()->json([
                [
                    'id' => 1,
                    'title' => 'Festival Silk Story',
                    'video' => 'https://player.vimeo.com/external/449802739.sd.mp4?s=4906e1d2d742d68ec5f2f8f7e73f5b87d8d9d9d&profile_id=164&oauth2_token_id=57447761',
                    'poster' => 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1200&h=1800&fit=crop&auto=format',
                    'is_active' => true,
                ],
                [
                    'id' => 2,
                    'title' => 'Morning Weave Ritual',
                    'video' => 'https://player.vimeo.com/external/449802739.sd.mp4?s=4906e1d2d742d68ec5f2f8f7e73f5b87d8d9d9d&profile_id=164&oauth2_token_id=57447761',
                    'poster' => 'https://images.unsplash.com/photo-1597897569252-9df44c7de0db?w=1200&h=1800&fit=crop&auto=format',
                    'is_active' => true,
                ],
            ]);
        }

        return response()->json($videos);
    }

    public function store(Request $request)
    {
        $request->validate([
            'title' => 'required|string|max:255',
            'video' => 'required|file|mimetypes:video/mp4,video/webm,video/quicktime,video/x-matroska,video/avi|max:1048576',
            'poster' => 'nullable|image|max:10240',
        ]);

        $videoPath = $request->file('video')
            ->store('videos', 'public');

        $posterPath = null;

        if ($request->hasFile('poster')) {
            $posterPath = $request->file('poster')
                ->store('video-posters', 'public');
        }

        $video = Video::create([
            'title' => $request->title,
            'video' => $videoPath,
            'poster' => $posterPath,
        ]);

        return response()->json($video, 201);
    }

    public function destroy($id)
    {
        $video = Video::findOrFail($id);

        $video->delete();

        return response()->json([
            'message' => 'Video deleted successfully'
        ]);
    }
}
