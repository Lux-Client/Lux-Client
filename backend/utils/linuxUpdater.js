const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { spawn } = require('child_process');

const execFileAsync = promisify(execFile);

/**
 * Helper to check if a binary exists and is executable
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file exists and is executable
 */
function isBinaryAvailable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Binary detection - cached at module load time
// ============================================================================

// Debian tools
const APT = isBinaryAvailable('/usr/bin/apt') || isBinaryAvailable('/usr/local/bin/apt');
const APT_GET = isBinaryAvailable('/usr/bin/apt-get') || isBinaryAvailable('/usr/local/bin/apt-get');
const DPKG = isBinaryAvailable('/usr/bin/dpkg') || isBinaryAvailable('/usr/local/bin/dpkg');

// RPM tools
const DNF = isBinaryAvailable('/usr/bin/dnf') || isBinaryAvailable('/usr/local/bin/dnf');
const RPM = isBinaryAvailable('/usr/bin/rpm');

// System classification (Debian wins if both toolsets exist)
const IS_DEBIAN = APT || APT_GET || DPKG;
const IS_RPM = !IS_DEBIAN && (RPM || DNF);
const IS_APPIMAGE = !!process.env.APPIMAGE;

// ============================================================================
// Asset selection
// ============================================================================

/**
 * Select the best asset for the current Linux system
 * @param {Array<{name: string}>} releaseAssets - Array of release assets with name field
 * @returns {Object|null} The selected asset object, or null if none match
 */
function selectLinuxAsset(releaseAssets) {
  if (!Array.isArray(releaseAssets) || releaseAssets.length === 0) {
    return null;
  }

  let priorities = [];

  if (IS_APPIMAGE) {
    // Running from AppImage - only accept AppImage updates
    priorities = ['.appimage'];
  } else if (IS_DEBIAN) {
    // Debian/Ubuntu system
    priorities = ['.deb', '.appimage', '.rpm'];
  } else if (IS_RPM) {
    // RedHat/Fedora/CentOS system
    priorities = ['.rpm', '.appimage', '.deb'];
  } else {
    // Unknown distro - prefer AppImage for portability
    priorities = ['.appimage', '.deb', '.rpm'];
  }

  // Search for assets in priority order
  for (const ext of priorities) {
    const asset = releaseAssets.find(a => a.name.toLowerCase().endsWith(ext));
    if (asset) {
      return asset;
    }
  }

  return null;
}

// ============================================================================
// Installation handlers
// ============================================================================

/**
 * Install a downloaded Linux asset
 * @param {string} filePath - Path to the downloaded file
 * @param {Object} options - Options object
 * @param {Object} options.shell - Electron shell object (for fallback)
 * @returns {Promise<void>}
 */
async function installLinuxAsset(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.appimage':
      return installAppImage(filePath);
    case '.deb':
      return installDeb(filePath);
    case '.rpm':
      return installRpm(filePath);
    default:
      return fallbackOpenPath(filePath, options.shell);
  }
}

/**
 * Install .AppImage file - make executable and spawn detached
 * @private
 */
function installAppImage(filePath) {
  return new Promise((resolve, reject) => {
    try {
      // Make file executable
      fs.chmodSync(filePath, 0o755);

      // Spawn in detached mode so it outlives the parent process
      const child = spawn(filePath, [], {
        detached: true,
        stdio: 'ignore'
      });

      // Unref allows parent process to exit without waiting for child
      child.unref();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Install .deb file via apt/apt-get or dpkg
 * @private
 */
async function installDeb(filePath) {
  const directory = path.dirname(filePath);
  const filename = path.basename(filePath);

  let command, args;

  if (APT) {
    command = 'pkexec';
    args = ['apt', 'install', '-y', `./${filename}`];
  } else if (APT_GET) {
    command = 'pkexec';
    args = ['apt-get', 'install', '-y', `./${filename}`];
  } else if (DPKG) {
    command = 'pkexec';
    args = ['dpkg', '-i', `./${filename}`];
  } else {
    throw new Error('No Debian package manager found (apt, apt-get, or dpkg)');
  }

  try {
    await execFileAsync(command, args, { cwd: directory });
  } catch (err) {
    throw new Error(`Failed to install .deb package: ${err.message}`);
  }
}

/**
 * Install .rpm file via dnf or rpm
 * @private
 */
async function installRpm(filePath) {
  const directory = path.dirname(filePath);
  const filename = path.basename(filePath);

  let command, args;

  if (DNF) {
    command = 'pkexec';
    args = ['dnf', 'install', '-y', filename];
  } else if (RPM) {
    command = 'pkexec';
    args = ['/usr/bin/rpm', '-Uvh', filename];
  } else {
    throw new Error('No RPM package manager found (rpm or dnf)');
  }

  try {
    await execFileAsync(command, args, { cwd: directory });
  } catch (err) {
    throw new Error(`Failed to install .rpm package: ${err.message}`);
  }
}

/**
 * Fallback: open the directory containing the file
 * @private
 */
async function fallbackOpenPath(filePath, shell) {
  if (!shell) {
    console.warn(`[linuxUpdater] Unable to auto-install ${filePath}. shell object not provided.`);
    return;
  }

  const directory = path.dirname(filePath);
  try {
    await shell.openPath(directory);
  } catch (err) {
    console.error(`[linuxUpdater] Failed to open directory ${directory}: ${err.message}`);
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  selectLinuxAsset,
  installLinuxAsset,
  // Exports for testing
  IS_APPIMAGE,
  IS_DEBIAN,
  IS_RPM,
  APT,
  APT_GET,
  DPKG,
  DNF
};
