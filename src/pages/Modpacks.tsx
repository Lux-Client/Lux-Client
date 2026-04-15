import React, { useState, useEffect } from 'react';
import OptimizedImage from '../components/OptimizedImage';

const Modpacks = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [installingPack, setInstallingPack] = useState(null);

    const searchModpacks = async (query = '') => {
        setLoading(true);
        try {
            const res = await window.electronAPI.searchModrinth(query, [['project_type:modpack']], { limit: 20 });
            if (res.hits) {
                setSearchResults(res.hits);
            }
        } catch (error) {
            console.error("Failed to search modpacks:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        searchModpacks();
    }, []);

    const handleSearch = (e) => {
        e.preventDefault();
        searchModpacks(searchQuery);
    };

    const handleInstall = async (pack) => {
        if (installingPack) return;
        try {
            setInstallingPack(pack.slug);

            const versions = await window.electronAPI.getModVersions(pack.slug, [], []);

            if (!versions || versions.length === 0) {
                alert("No versions found for this modpack.");
                setInstallingPack(null);
                return;
            }
            const latestVersion = versions[0];
            const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];

            if (!primaryFile) {
                alert("No file found for the latest version.");
                setInstallingPack(null);
                return;
            }
            const res = await window.electronAPI.installModpack(primaryFile.url, pack.title, pack.icon_url);

            if (res.success) {
                alert(`Started installing ${pack.title}. Check Dashboard/Downloads for progress.`);
            } else {
                alert(`Failed to install: ${res.error}`);
            }

        } catch (e) {
            console.error("Install failed components:", e);
            alert("An error occurred during installation.");
        } finally {
            setInstallingPack(null);
        }
    };

    return (
        <div className="h-full flex flex-col text-foreground p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Modpacks</h1>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search Modpacks..."
                        className="bg-muted border border-border rounded-xl px-4 py-2 w-64 focus:outline-none focus:border-primary/50 transition-colors"
                    />
                    <button type="submit" className="bg-primary/20 hover:bg-primary/30 text-primary px-4 py-2 rounded-xl transition-colors">
                        Search
                    </button>
                </form>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {searchResults.map((pack) => (
                            <div key={pack.slug} className="bg-muted border border-border rounded-xl p-4 hover:bg-accent transition-all group flex flex-col h-[320px]">
                                <div className="h-32 w-full mb-4 rounded-lg overflow-hidden bg-muted relative">
                                    {pack.icon_url ? (
                                        <OptimizedImage
                                            src={pack.icon_url}
                                            alt={pack.title}
                                            className="w-full h-full object-cover transition-transform duration-500"
                                            fallback={
                                                <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-muted">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                                    </svg>
                                                </div>
                                            }
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                            </svg>
                                        </div>
                                    )}
                                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md text-xs font-bold border border-border">
                                        Modpack
                                    </div>
                                </div>

                                <h3 className="text-xl font-bold truncate mb-1" title={pack.title}>{pack.title}</h3>
                                <p className="text-sm text-muted-foreground mb-2 truncate">by {pack.author}</p>
                                <p className="text-xs text-muted-foreground line-clamp-3 mb-auto">{pack.description}</p>

                                <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                                    <div className="flex gap-2 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                                            {pack.downloads.toLocaleString()}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => handleInstall(pack)}
                                        disabled={installingPack === pack.slug}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-lg ${installingPack === pack.slug
                                            ? 'bg-muted cursor-not-allowed text-muted-foreground'
                                            : 'bg-primary hover:bg-primary-hover text-black'
                                            }`}
                                    >
                                        {installingPack === pack.slug ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                                                Starting...
                                            </span>
                                        ) : (
                                            'Create Instance'
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modpacks;