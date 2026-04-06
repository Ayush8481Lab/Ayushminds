export default async function handler(req, res) {
    const vid = req.query.vid;

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

        // 2. Process all songs concurrently to handle the 5-40s latency efficiently
        const enrichedRecommendations = await Promise.all(
            recomData.recommendations.map(async (song) => {
                const title = song.Title || "";
                const artist = song.Artists || "";
                
                // Keep the search query clean (First 2 artists max to improve search results)
                const searchArtist = artist ? artist.split(',').slice(0, 2).join(' ') : "";
                const query = `${title} ${searchArtist}`.trim();

                let spotifyUrl = "Not Found";

                try {
                    // Fetch from your custom Spotify API
                    const spotRes = await fetch(`https://ayushspot.vercel.app/api?query=${encodeURIComponent(query)}`);
                    
                    if (spotRes.ok) {
                        const spotData = await spotRes.json();
                        
                        // Pass to our custom matching function
                        const match = performMatching(spotData, title, artist);
                        
                        // If match is found, extract the direct song_link
                        if (match && match.song_link) {
                            spotifyUrl = match.song_link;
                        }
                    }
                } catch (e) {
                    console.error(`Spotify Search Failed for: ${title}`);
                }

                // Return in your exact requested format
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

// ==========================================
// EXACT MATCHING LOGIC UPDATED FOR NEW API
// ==========================================
function performMatching(apiData, targetTrack, targetArtist) {
    // Safety check for the specific structure of ayushspot API
    if (!apiData || apiData.status !== "success" || !apiData.data || !Array.isArray(apiData.data)) {
        return null;
    }
    
    const clean = (s) => (s || "").toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
    const tTitle = clean(targetTrack); 
    const tArtist = clean(targetArtist);
    
    let bestMatch = null; 
    let highestScore = 0;
    
    // Using a standard loop to prevent execution cut-offs
    for (let i = 0; i < apiData.data.length; i++) {
        const track = apiData.data[i];
        if (!track) continue;
        
        const rTitle = clean(track.title); 
        const rawArtist = track.artist_names || "";
        
        // Extract artists from comma-separated string
        const rArtists = rawArtist.split(',').map(a => clean(a));
        
        let score = 0; 
        let artistMatched = false;
        
        if (tArtist.length > 0) {
            for (let j = 0; j < rArtists.length; j++) { 
                let ra = rArtists[j];
                if (ra === tArtist) { 
                    score += 100; 
                    artistMatched = true; 
                    break; 
                } else if (ra.includes(tArtist) || tArtist.includes(ra)) { 
                    score += 80; 
                    artistMatched = true; 
                    break; 
                } 
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
    }
    
    return highestScore > 0 ? bestMatch : null;
}
