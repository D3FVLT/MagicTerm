const { execSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  if (process.platform !== 'darwin') {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`Re-signing app with ad-hoc signature: ${appPath}`);

  try {
    // `--sign -` is an ad-hoc signature (no certificate); --deep covers nested helpers.
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' }
    );
    console.log('Successfully re-signed app with ad-hoc signature');
  } catch (error) {
    console.error('Failed to re-sign app:', error.message);
  }
};
