export default async function handler(req, res) {
    const { vid } = req.query;

    if (!vid) {
        return res.status(400).json({ error: "Missing 'vid' parameter. Use /api/rec?vid=..." });
    }

    try {
        // 1. Fetch initial recommendations
        const recomResponse = await fetch(`https://recomserver.vercel.app/api?vid=${vid}`);
        const recomData = await recomResponse.json();
        
        if (!recomData.recommendations || recomData.recommendations.length === 0) {
            return res.status(404).json({ error: "No recommendations found." });
        }

        // 2. Process all songs concurrently to save time
        const enrichedRecommendations = await Promise.all(
            recomData.recommendations.map(async (song) => {
                const title = song.Title;
                const artistsStr = song.Artists || "";
                
                // Get main artist for the search query
                const searchArtist = artistsStr ? artistsStr.split(',').slice(0, 2).join(' ') : "";
                const query = `${title} ${searchArtist}`.trim();

                let spotifyUrl = "Not Found";

                try {
                    // Fetch from your custom Spotify API
                    const spotRes = await fetch(`https://ayushspot.vercel.app/api?query=${encodeURIComponent(query)}`);
                    if (spotRes.ok) {
                        const spotData = await spotRes.json();
                        
                        // Exact match logic from your HTML file
                        const match = performMatching(spotData, title, artistsStr);
                        
                        if (match && match.id) {
                            spotifyUrl = `https://open.spotify.com/track/${match.id}`;
                        }
                    }
                } catch (e) {
                    console.error(`Spotify Search Failed for: ${title}`);
                }

                return {
                    Title: song.Title,
                    Artists: song.Artists,
                    Banner: song.Banner,
                    Stream: song.Stream,
                    "Perma URL": song["Perma URL"],
                    Spotify: spotifyUrl
                };
            })
        );

        // 3. Return final formatted JSON
        res.status(200).json({ recommendations: enrichedRecommendations });

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
}

// Exactly extracted and adapted matching technique
function performMatching(apiData, targetTrack, targetArtist) {
    // Determine array path (handles standard Spotify OR RapidAPI formats safely)
    let trackList = [];
    if (apiData.tracks && apiData.tracks.items) trackList = apiData.tracks.items; 
    else if (apiData.tracks && Array.isArray(apiData.tracks)) trackList = apiData.tracks;
    else if (Array.isArray(apiData)) trackList = apiData;

    if (trackList.length === 0) return null;
    
    const clean = (s) => (s || "").toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
    const tTitle = clean(targetTrack); 
    const tArtist = clean(targetArtist);
    
    let bestMatch = null; 
    let highestScore = 0;
    
    trackList.forEach(item => {
        // Standardize format differences
        const track = item.data ? item.data : item; 
        if (!track) return;
        
        const rTitle = clean(track.name); 
        
        // Extract artists safely
        let rArtists = [];
        if (track.artists && track.artists.items) {
            rArtists = track.artists.items.map(a => clean(a.profile ? a.profile.name : a.name));
        } else if (track.artists && Array.isArray(track.artists)) {
            rArtists = track.artists.map(a => clean(a.name));
        }
        
        let score = 0; 
        let artistMatched = false;
        
        if (tArtist.length > 0) {
            for (let ra of rArtists) { 
                if (ra === tArtist) { score += 100; artistMatched = true; break; } 
                else if (ra.includes(tArtist) || tArtist.includes(ra)) { score += 80; artistMatched = true; break; } 
            }
            if (!artistMatched) score = 0;
        } else { 
            score += 50; 
        }
        
        if (score > 0) { 
            if (rTitle === tTitle) score += 100; 
            else if (rTitle.startsWith(tTitle) || tTitle.startsWith(rTitle)) score += 80; 
            else if (rTitle.includes(tTitle)) score += 50; 
        }
        
        if (score > highestScore) { 
            highestScore = score; 
            bestMatch = track; 
        }
    });
    
    return highestScore > 0 ? bestMatch : null;
}
