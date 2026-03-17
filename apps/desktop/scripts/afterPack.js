const { execSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  // Only run on macOS
  if (process.platform !== 'darwin') {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`Re-signing app with ad-hoc signature: ${appPath}`);

  try {
    // Remove all existing signatures and re-sign with ad-hoc identity
    // The --deep flag ensures all nested code is signed
    // The -s - means ad-hoc signing (no certificate)
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' }
    );
    console.log('Successfully re-signed app with ad-hoc signature');
  } catch (error) {
    console.error('Failed to re-sign app:', error.message);
    // Don't fail the build, just warn
  }
};
