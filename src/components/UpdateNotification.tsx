import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

function UpdateNotification() {
  const { t } = useTranslation();
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let unlistenProgress: () => void;
    let unlistenAvailable: () => void;
    let unlistenDownloaded: () => void;
    let unlistenError: () => void;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("update-available", (event) => {
        setUpdateInfo(event.payload);
        setIsVisible(true);
      }).then((un) => (unlistenAvailable = un));

      listen("update-progress", (event) => {
        setDownloadProgress(event.payload);
        setIsVisible(true);
      }).then((un) => (unlistenProgress = un));

      listen("update-downloaded", (event) => {
        setIsDownloaded(true);
        setIsVisible(true);
      }).then((un) => (unlistenDownloaded = un));

      listen("update-error", (event) => {
        console.error(
          "[UpdateNotification] Update error received:",
          event.payload,
        );
        setError(event.payload);
        setIsVisible(true);
        setTimeout(() => setIsVisible(false), 10000);
      }).then((un) => (unlistenError = un));
    });

    return () => {
      if (unlistenAvailable) unlistenAvailable();
      if (unlistenProgress) unlistenProgress();
      if (unlistenDownloaded) unlistenDownloaded();
      if (unlistenError) unlistenError();
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 left-6 z-[100] w-80 bg-surface backdrop-blur-xl border border-stroke rounded-xl p-4 shadow-2xl animate-in fade-in slide-in-from-left-4 duration-300">
      <div className="flex items-start gap-3">
        <div
          className={`p-2 rounded-xl ${isDownloaded ? "bg-primary/20 text-primary" : error ? "bg-red-500/20 text-red-500" : "bg-blue-500/20 text-blue-400"}`}
        >
          {isDownloaded ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : error ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 animate-bounce"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-foreground text-sm">
            {error
              ? "Update Error"
              : isDownloaded
                ? "Update Ready"
                : "Downloading Update"}
          </h4>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {error
              ? error
              : isDownloaded
                ? `Version ${updateInfo?.version} is ready to install`
                : `Downloading version ${updateInfo?.version || "..."}`}
          </p>

          {!isDownloaded && !error && downloadProgress && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>{Math.round(downloadProgress.percent)}%</span>
                <span>
                  {Math.round(
                    (downloadProgress.bytesPerSecond / 1024 / 1024) * 10,
                  ) / 10}{" "}
                  MB/s
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${downloadProgress.percent}%` }}
                ></div>
              </div>
            </div>
          )}

          {isDownloaded && (
            <button
              onClick={() => window.electronAPI.restartAndInstall()}
              className="mt-4 w-full bg-primary text-black font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
            >
              Restart and Install
            </button>
          )}
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="text-muted-foreground hover:text-accent-foreground transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default UpdateNotification;
