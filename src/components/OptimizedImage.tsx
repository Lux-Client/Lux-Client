import React, { useState, useEffect, useRef } from 'react';
import { imageCache } from '../utils/lruCache';

const OptimizedImage = ({ src, alt, className, fallback, ...props }) => {
    const cached = imageCache.get(src);
    const [isVisible, setIsVisible] = useState(false);
    const [isLoaded, setIsLoaded] = useState(!!cached);
    const [error, setError] = useState(false);
    const imgRef = useRef(null);

    useEffect(() => {
        // If image is already in cache, we don't need the observer
        if (cached) {
            setIsVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '100px' }
        );

        if (imgRef.current) {
            observer.observe(imgRef.current);
        }

        return () => observer.disconnect();
    }, [src, cached]);

    if (error && fallback) return fallback;

    return (
        <div ref={imgRef} className={`relative overflow-hidden ${className}`}>
            {isVisible && !error && (
                <img
                    src={src}
                    alt={alt}
                    className={`w-full h-full object-cover transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                    onLoad={() => {
                        setIsLoaded(true);
                        imageCache.set(src, 'loaded');
                    }}
                    onError={() => setError(true)}
                    {...props}
                />
            )}
            {!isLoaded && !error && (
                <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
                    <div className="w-1/3 h-1/3 border border-border rounded-full opacity-20"></div>
                </div>
            )}
        </div>
    );
};

export default OptimizedImage;