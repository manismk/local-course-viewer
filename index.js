// Main application state
const appState = {
  rootHandle: null,
  currentDirectory: null,
  currentPath: [],
  videoProgress: {},
  player: null,
  currentVideoPath: null,
  currentPlaybackRate: 1,
  currentVideoIndex: -1,
  videoFiles: [],
  autoplayEnabled: false,
};

// DOM Elements
const selectFolderBtn = document.getElementById("select-folder-btn");
const fileBrowser = document.getElementById("file-browser");
const breadcrumb = document.getElementById("breadcrumb");
const videoTitle = document.getElementById("video-title");
const videoPlayer = document.getElementById("video-player");
const emptyPlayerState = document.getElementById("empty-player-state");
const sortSelect = document.getElementById("sort-select");
const prevVideoBtn = document.getElementById("prev-video-btn");
const nextVideoBtn = document.getElementById("next-video-btn");
const autoplayToggle = document.getElementById("autoplay-toggle");

// Initialize VideoJS player
function initPlayer() {
  if (appState.player) {
    appState.player.dispose();
  }

  // Hide empty state and show video player
  emptyPlayerState.classList.add("hidden");
  videoPlayer.classList.remove("hidden");

  appState.player = videojs("video-player", {
    controls: true,
    autoplay: false,
    preload: "auto",
    fluid: true,
    playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3],
    controlBar: {
      children: [
        "playToggle",
        "volumePanel",
        "currentTimeDisplay",
        "timeDivider",
        "durationDisplay",
        "progressControl",
        "playbackRateMenuButton",
        "fullscreenToggle",
      ],
    },
  });

  // Save progress on timeupdate
  appState.player.on("timeupdate", () => {
    if (!appState.currentVideoPath) return;
    const currentTime = appState.player.currentTime();
    const duration = appState.player.duration();
    if (currentTime && duration) {
      appState.videoProgress[appState.currentVideoPath] = {
        currentTime,
        duration,
        percentage: (currentTime / duration) * 100,
      };
    }
  });

  // Save playback rate when changed - this is now global, not per video
  appState.player.on("ratechange", (...args) => {
    appState.currentPlaybackRate = appState.player.playbackRate();
    if (appState.currentPlaybackRate !== 1) {
      window.localStorage.setItem(
        "currentPlaybackRate",
        appState.currentPlaybackRate
      );
    }
  });

  // Handle video ended for autoplay
  appState.player.on("ended", () => {
    if (appState.autoplayEnabled && appState.currentVideoIndex < appState.videoFiles.length - 1) {
      setTimeout(() => {
        loadNextVideo();
      }, 1000); // Small delay before autoplaying next video
    }
  });
}

// Select folder using File System Access API
async function selectFolder() {
  try {
    appState.rootHandle = await window.showDirectoryPicker();
    appState.currentDirectory = appState.rootHandle;
    appState.currentPath = [];

    updateBreadcrumb();
    await displayFolderContents(appState.currentDirectory);
  } catch (error) {
    console.error("Error selecting folder:", error);
  }
}

// Update breadcrumb navigation
function updateBreadcrumb() {
  breadcrumb.innerHTML = "";

  // Add root item
  const homeItem = document.createElement("span");
  homeItem.className = "breadcrumb-item";
  homeItem.textContent = "Home";
  homeItem.dataset.path = "";
  homeItem.addEventListener("click", () => navigateToPath([]));
  breadcrumb.appendChild(homeItem);

  // Add path items
  for (let i = 0; i < appState.currentPath.length; i++) {
    // Add separator
    const separator = document.createElement("span");
    separator.className = "breadcrumb-separator";
    separator.textContent = "›";
    breadcrumb.appendChild(separator);

    // Add path item
    const pathItem = document.createElement("span");
    pathItem.className = "breadcrumb-item";
    pathItem.textContent = appState.currentPath[i];

    // Only make it clickable if it's not the last item
    if (i < appState.currentPath.length - 1) {
      pathItem.addEventListener("click", () => {
        navigateToPath(appState.currentPath.slice(0, i + 1));
      });
    }

    breadcrumb.appendChild(pathItem);
  }
}

// Navigate to a specific path
async function navigateToPath(path) {
  let current = appState.rootHandle;

  for (const segment of path) {
    current = await current.getDirectoryHandle(segment);
  }

  appState.currentDirectory = current;
  appState.currentPath = path;

  updateBreadcrumb();
  await displayFolderContents(appState.currentDirectory);
}

// Update current video highlighting in sidebar
function updateCurrentVideoHighlight() {
  // Remove current-video class from all file items
  const allFileItems = document.querySelectorAll('.file-item');
  allFileItems.forEach(item => item.classList.remove('current-video'));

  // Add current-video class to the currently playing video
  if (appState.currentVideoPath) {
    const currentFileName = appState.currentVideoPath.split('/').pop();
    allFileItems.forEach(item => {
      const fileName = item.querySelector('.file-name').textContent;
      if (fileName === currentFileName) {
        item.classList.add('current-video');
      }
    });
  }
}

// Display folder contents
async function displayFolderContents(directoryHandle) {
  fileBrowser.innerHTML = "";

  // Separate folders and files
  const entries = [];
  for await (const entry of directoryHandle.values()) {
    entries.push({
      name: entry.name,
      kind: entry.kind,
      handle: entry,
    });
  }

  // Get file metadata for sorting
  for (const entry of entries) {
    if (entry.kind === "file") {
      try {
        const file = await entry.handle.getFile();
        entry.lastModified = file.lastModified;
        entry.size = file.size;
      } catch (error) {
        console.error(`Error getting file metadata for ${entry.name}:`, error);
        entry.lastModified = 0;
        entry.size = 0;
      }
    }
  }

  // Get current sort option
  const sortOption = document.getElementById("sort-select").value;

  // Sort based on selected option
  entries.sort((a, b) => {
    // Always put folders first
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }

    // Then sort by the selected criteria
    switch (sortOption) {
      case "name-asc":
        // Natural sort to handle numbers correctly
        return naturalSort(a.name, b.name);
      case "name-desc":
        // Natural sort to handle numbers correctly
        return naturalSort(b.name, a.name);
      case "date-asc":
        return (a.lastModified || 0) - (b.lastModified || 0);
      case "date-desc":
        return (b.lastModified || 0) - (a.lastModified || 0);
      default:
        return naturalSort(a.name, b.name);
    }
  });

  // Reset video files array
  appState.videoFiles = [];

  // Create elements for each entry
  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = entry.kind === "directory" ? "folder-item" : "file-item";

    const icon = document.createElement("span");
    icon.className = entry.kind === "directory" ? "folder-icon" : "file-icon";
    icon.textContent = entry.kind === "directory" ? "📁" : "🎬";

    const name = document.createElement("span");
    name.className = entry.kind === "directory" ? "folder-name" : "file-name";
    name.textContent = entry.name;

    item.appendChild(icon);
    item.appendChild(name);

    // Add progress indicator for video files
    if (entry.kind === "file" && isVideoFile(entry.name)) {
      // Add to video files array
      appState.videoFiles.push({
        name: entry.name,
        handle: entry.handle,
        path: [...appState.currentPath, entry.name].join("/"),
      });

      const fullPath = [...appState.currentPath, entry.name].join("/");

      if (appState.videoProgress[fullPath]) {
        const progressWrapper = document.createElement("div");
        progressWrapper.className = "progress-indicator";

        const progressBar = document.createElement("div");
        progressBar.className = "progress-bar";
        progressBar.style.width = `${appState.videoProgress[fullPath].percentage}%`;

        progressWrapper.appendChild(progressBar);
        item.appendChild(progressWrapper);
      }
    }

    // Add click event
    if (entry.kind === "directory") {
      item.addEventListener("click", async () => {
        appState.currentPath.push(entry.name);
        appState.currentDirectory = entry.handle;

        updateBreadcrumb();
        await displayFolderContents(entry.handle);
      });
    } else if (isVideoFile(entry.name)) {
      item.addEventListener("click", () => {
        // Find index of this video in the videoFiles array
        const videoIndex = appState.videoFiles.findIndex(
          (v) => v.name === entry.name
        );
        appState.currentVideoIndex = videoIndex;

        loadVideo(entry.handle, entry.name);
        updateNavigationButtons();
      });
    }

    fileBrowser.appendChild(item);
  }

  // Show empty state if no entries
  if (entries.length === 0) {
    fileBrowser.innerHTML =
      '<div class="message">No files or folders found</div>';
  }

  // Disable navigation buttons when changing folders
  prevVideoBtn.disabled = true;
  nextVideoBtn.disabled = true;

  // Update current video highlighting
  updateCurrentVideoHighlight();
}

// Function for natural sorting (1, 2, 10 instead of 1, 10, 2)
function naturalSort(a, b) {
  const aParts = a.split(/(\d+)/).filter(Boolean);
  const bParts = b.split(/(\d+)/).filter(Boolean);

  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    // If both parts are numeric
    if (!isNaN(aParts[i]) && !isNaN(bParts[i])) {
      const numA = parseInt(aParts[i], 10);
      const numB = parseInt(bParts[i], 10);
      if (numA !== numB) {
        return numA - numB;
      }
    }
    // If parts don't match, compare as strings
    else if (aParts[i] !== bParts[i]) {
      return aParts[i].localeCompare(bParts[i]);
    }
  }

  // If all compared parts are equal, the shorter one comes first
  return aParts.length - bParts.length;
}

// Check if file is a video
function isVideoFile(filename) {
  const videoExtensions = [".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi"];
  const extension = filename.substring(filename.lastIndexOf(".")).toLowerCase();
  return videoExtensions.includes(extension);
}

// Load video for playback
async function loadVideo(fileHandle, fileName) {
  try {
    // Get file
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);

    // Set current video path for progress tracking
    appState.currentVideoPath = [...appState.currentPath, fileName].join("/");

    // Update UI
    videoTitle.textContent = fileName;

    // Initialize player if not already done
    if (!appState.player) {
      initPlayer();
    } else {
      // Ensure empty state is hidden and player is visible
      emptyPlayerState.classList.add("hidden");
      videoPlayer.classList.remove("hidden");
    }

    // Set video source
    appState.player.src({
      src: url,
      type: getVideoMimeType(fileName),
    });

    // Restore progress and playback rate if available
    if (appState.videoProgress[appState.currentVideoPath]) {
      const savedData = appState.videoProgress[appState.currentVideoPath];

      appState.player.one("loadedmetadata", () => {
        // Restore time position
        if (savedData.currentTime) {
          appState.player.currentTime(savedData.currentTime);
        }

        // Restore playback rate
        if (savedData.playbackRate) {
          appState.player.playbackRate(savedData.playbackRate);
        } else {
          // Use the last used playback rate
          appState.player.playbackRate(appState.currentPlaybackRate);
        }
      });
    } else {
      // No saved progress, but set the last used playback rate
      appState.player.one("loadedmetadata", () => {
        appState.player.playbackRate(appState.currentPlaybackRate);
      });
    }

    // Play the video after a short delay to ensure it's loaded
    setTimeout(() => {
      appState.player.play().catch((e) => {
        console.log("Autoplay prevented, click play to start video", e);
      });
      appState.player.playbackRate(
        window.localStorage.getItem("currentPlaybackRate") || 1
      );
    }, 100);

    // Add listener to clean up URL object when done
    appState.player.one("dispose", () => {
      URL.revokeObjectURL(url);
    });

    // Update navigation buttons
    updateNavigationButtons();

    // Update current video highlighting in sidebar
    updateCurrentVideoHighlight();
  } catch (error) {
    console.error("Error loading video:", error);
    alert("Error loading video: " + error.message);
  }
}

// Update the previous/next navigation buttons
function updateNavigationButtons() {
  // Disable both buttons by default
  prevVideoBtn.disabled = true;
  nextVideoBtn.disabled = true;

  // If we don't have a current video or no videos in the folder, leave buttons disabled
  if (appState.currentVideoIndex === -1 || appState.videoFiles.length === 0) {
    return;
  }

  // Enable previous button if not at the beginning
  if (appState.currentVideoIndex > 0) {
    prevVideoBtn.disabled = false;
  }

  // Enable next button if not at the end
  if (appState.currentVideoIndex < appState.videoFiles.length - 1) {
    nextVideoBtn.disabled = false;
  }
}

// Navigate to the previous video
function loadPreviousVideo() {
  if (appState.currentVideoIndex <= 0 || appState.videoFiles.length === 0) {
    return; // Already at the first video or no videos
  }

  const prevIndex = appState.currentVideoIndex - 1;
  const prevVideo = appState.videoFiles[prevIndex];

  appState.currentVideoIndex = prevIndex;
  loadVideo(prevVideo.handle, prevVideo.name);
}

// Navigate to the next video
function loadNextVideo() {
  if (
    appState.currentVideoIndex >= appState.videoFiles.length - 1 ||
    appState.videoFiles.length === 0
  ) {
    return; // Already at the last video or no videos
  }

  const nextIndex = appState.currentVideoIndex + 1;
  const nextVideo = appState.videoFiles[nextIndex];

  appState.currentVideoIndex = nextIndex;
  loadVideo(nextVideo.handle, nextVideo.name);
}

// Get MIME type based on file extension
function getVideoMimeType(filename) {
  const extension = filename.substring(filename.lastIndexOf(".")).toLowerCase();

  const mimeTypes = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "video/ogg",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
  };

  return mimeTypes[extension] || "video/mp4";
}

// Event listeners
selectFolderBtn.addEventListener("click", selectFolder);
sortSelect.addEventListener("change", () => {
  // Reload current directory with new sorting
  displayFolderContents(appState.currentDirectory);
});

// Navigation button listeners
prevVideoBtn.addEventListener("click", loadPreviousVideo);
nextVideoBtn.addEventListener("click", loadNextVideo);

// Autoplay toggle listener
autoplayToggle.addEventListener("change", (e) => {
  appState.autoplayEnabled = e.target.checked;
  // Save autoplay preference to localStorage
  window.localStorage.setItem("autoplayEnabled", appState.autoplayEnabled);
});

// Keyboard shortcuts for navigation
document.addEventListener("keydown", (e) => {
  // Only handle when player is active and we're not in an input field
  if (
    document.activeElement.tagName === "INPUT" ||
    document.activeElement.tagName === "TEXTAREA" ||
    document.activeElement.tagName === "SELECT"
  ) {
    return;
  }

  // Left arrow (with Alt key) for previous video
  if (e.key === "ArrowLeft" && e.altKey) {
    if (!prevVideoBtn.disabled) {
      loadPreviousVideo();
      e.preventDefault();
    }
  }

  // Right arrow (with Alt key) for next video
  if (e.key === "ArrowRight" && e.altKey) {
    if (!nextVideoBtn.disabled) {
      loadNextVideo();
      e.preventDefault();
    }
  }
});

// Initialize the app
document.addEventListener("DOMContentLoaded", () => {
  // Check if browser supports File System Access API
  if (!("showDirectoryPicker" in window)) {
    alert(
      "Your browser does not support the File System Access API. Please use Chrome, Edge, or another compatible browser."
    );
    selectFolderBtn.disabled = true;
  }

  // Restore autoplay setting from localStorage
  const savedAutoplay = window.localStorage.getItem("autoplayEnabled");
  if (savedAutoplay !== null) {
    appState.autoplayEnabled = savedAutoplay === "true";
    autoplayToggle.checked = appState.autoplayEnabled;
  }
});
