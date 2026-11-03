<?php

namespace App\Http\Controllers;

use App\Models\Video;
use Illuminate\Http\Request;

class VideoController extends Controller
{
    public function index()
    {
        return response()->json(
            Video::where('is_active', true)
                ->latest()
                ->get()
        );
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
