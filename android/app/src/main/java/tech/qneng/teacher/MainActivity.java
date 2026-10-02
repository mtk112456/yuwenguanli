package tech.qneng.teacher;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.WebViewListener;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {

    private static final String SERVER_HOST = "qi.qnengs.tech";
    private static final String HOME_URL = "https://" + SERVER_HOST + "/admin/teacher/index.php";

    private static final int MAX_MAIN_FRAME_RETRIES = 3;
    private static final long RETRY_DELAY_MS = 1500;
    private int mainFrameRetryCount = 0;
    private final Handler retryHandler = new Handler(Looper.getMainLooper());

    private static final int REQUEST_CODE_INSTALL_PERMISSION = 10086;
    private File pendingInstallApkFile = null;
    private AlertDialog downloadDialog = null;
    private boolean isDownloadingApk = false;
    private Thread downloadThread = null;

    private long lastBackPressTime = 0;
    private Toast exitToast;

    private String escapeHtml(String value) {
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;");
    }

    // 自动重连过渡画面
    private String buildRetryingHtml(int currentRetry, int maxRetry) {
        return
        "<!DOCTYPE html>" +
        "<html><head><meta charset='utf-8'>" +
        "<meta name='viewport' content='width=device-width, initial-scale=1.0, viewport-fit=cover'>" +
        "<style>" +
        "  body { margin: 0; background: #1e3a5f; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; min-height: 100dvh; text-align: center; box-sizing: border-box; padding: 24px; }" +
        "  .card { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 20px; padding: 36px 24px; max-width: 320px; width: 100%; }" +
        "  .spinner { width: 44px; height: 44px; border: 3px solid rgba(255, 255, 255, 0.2); border-top-color: #f8fafc; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }" +
        "  @keyframes spin { to { transform: rotate(360deg); } }" +
        "  h2 { font-size: 18px; margin: 0 0 10px; font-weight: 600; }" +
        "  p { font-size: 13.5px; color: rgba(248, 250, 252, 0.75); line-height: 1.6; margin: 0; }" +
        "</style></head><body>" +
        "<div class='card'>" +
        "  <div class='spinner'></div>" +
        "  <h2>网络连接中…</h2>" +
        "  <p>正在尝试自动重连教学系统</p>" +
        "  <p style='margin-top:10px'>第 " + currentRetry + " / " + maxRetry + " 次重试</p>" +
        "</div>" +
        "</body></html>";
    }

    // 断网兜底页
    private String buildErrorHtml(int errorCode, String description) {
        String diagReason = "网络信号偏弱，请检查手机网络";
        if (errorCode == -2) {
            diagReason = "DNS 域名解析超时，请检查手机网络连通性";
        } else if (errorCode == -8) {
            diagReason = "连接超时，请确认教学系统服务器已开机";
        } else if (errorCode == -6) {
            diagReason = "无法连接到教学系统服务器";
        } else if (errorCode == -7) {
            diagReason = "网络数据读写中断 (IO Error)";
        } else if (description != null && !description.trim().isEmpty()) {
            diagReason = description.trim();
        }
        String safeDiag = escapeHtml(diagReason);

        return
        "<!DOCTYPE html>" +
        "<html><head><meta charset='utf-8'>" +
        "<meta name='viewport' content='width=device-width, initial-scale=1.0, viewport-fit=cover'>" +
        "<style>" +
        "  body { margin: 0; padding: 24px; background: #1e3a5f; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; min-height: 100dvh; text-align: center; box-sizing: border-box; }" +
        "  .card { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 20px; padding: 32px 24px; max-width: 320px; width: 100%; }" +
        "  .icon-box { width: 64px; height: 64px; background: rgba(248, 250, 252, 0.12); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 30px; }" +
        "  h2 { font-size: 19px; margin: 0 0 10px; font-weight: 600; }" +
        "  p { font-size: 13.5px; color: rgba(248, 250, 252, 0.75); line-height: 1.6; margin: 0 0 12px; }" +
        "  .server-box { background: rgba(0, 0, 0, 0.22); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 10px 12px; margin: 0 0 18px; font-size: 11.5px; color: rgba(248, 250, 252, 0.7); line-height: 1.5; text-align: left; word-break: break-all; }" +
        "  .retry-btn { display: inline-block; width: 100%; min-height: 48px; line-height: 48px; background: rgba(255, 255, 255, 0.92); color: #1e3a5f; font-size: 15px; font-weight: 600; border-radius: 12px; border: none; cursor: pointer; text-decoration: none; box-sizing: border-box; touch-action: manipulation; }" +
        "  .retry-btn:active { transform: scale(0.97); opacity: 0.9; }" +
        "</style></head><body>" +
        "<div class='card'>" +
        "  <div class='icon-box'>📶</div>" +
        "  <h2>暂时无法连接教学系统</h2>" +
        "  <p>请检查网络后重新连接</p>" +
        "  <div class='server-box'>" +
        "    <div><b>诊断：</b>" + safeDiag + "</div>" +
        "    <div style='margin-top:3px'><b>目标：</b>" + escapeHtml(HOME_URL) + "</div>" +
        "  </div>" +
        "  <a href='" + escapeHtml(HOME_URL) + "' id='retry-btn' class='retry-btn'>重新连接 (5s)</a>" +
        "</div>" +
        "<script>" +
        "  var count = 5;" +
        "  var timer = null;" +
        "  function cancelCountdown() { if (timer) { clearInterval(timer); timer = null; } var btn = document.getElementById('retry-btn'); if (btn) btn.innerText = '立即重新连接'; }" +
        "  var rBtn = document.getElementById('retry-btn'); if (rBtn) rBtn.addEventListener('click', cancelCountdown);" +
        "  timer = setInterval(function() {" +
        "    count--;" +
        "    var btn = document.getElementById('retry-btn');" +
        "    if (btn) btn.innerText = '重新连接 (' + count + 's)';" +
        "    if (count <= 0) {" +
        "      clearInterval(timer);" +
        "      window.location.href = '" + escapeHtml(HOME_URL) + "';" +
        "    }" +
        "  }, 1000);" +
        "</script>" +
        "</body></html>";
    }

    private void handleMainFrameError(WebView view, int errorCode, String description, String failingUrl) {
        if (view == null) return;

        if (mainFrameRetryCount < MAX_MAIN_FRAME_RETRIES) {
            mainFrameRetryCount++;
            final int currentRetry = mainFrameRetryCount;
            view.loadDataWithBaseURL(null, buildRetryingHtml(currentRetry, MAX_MAIN_FRAME_RETRIES), "text/html", "utf-8", null);

            retryHandler.postDelayed(() -> {
                if (!isFinishing() && !isDestroyed()) {
                    String targetUrl = (failingUrl != null && !failingUrl.isEmpty() && !failingUrl.startsWith("data:"))
                        ? failingUrl
                        : HOME_URL;
                    view.loadUrl(targetUrl);
                }
            }, RETRY_DELAY_MS);
            return;
        }

        mainFrameRetryCount = 0;
        view.loadDataWithBaseURL(null, buildErrorHtml(errorCode, description), "text/html", "utf-8", null);
    }

    private String buildEnhanceJs(String appVersionName, long appVersionCode) {
        String safeVersionName = appVersionName
            .replace("\\", "\\\\")
            .replace("'", "\\'");

        return
        "(function() {" +
        "  window.IS_TEACHER_APP = true;" +
        "  window.APP_VERSION_NAME = '" + safeVersionName + "';" +
        "  window.APP_VERSION_CODE = " + appVersionCode + ";" +
        "  try { localStorage.setItem('is_teacher_app', '1'); } catch(e) {}" +
        "  if (window.__teacher_app_enhanced_v1) return;" +
        "  window.__teacher_app_enhanced_v1 = true;" +
        "  var style = document.createElement('style');" +
        "  style.innerHTML = `" +
        "    * { -webkit-tap-highlight-color: transparent !important; }" +
        "  `;" +
        "  document.head.appendChild(style);" +
        "  document.addEventListener('focusin', function(e) {" +
        "    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {" +
        "      setTimeout(function() {" +
        "        try {" +
        "          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });" +
        "        } catch(err) {" +
        "          e.target.scrollIntoView(false);" +
        "        }" +
        "      }, 280);" +
        "    }" +
        "  });" +
        "})();";
    }

    private String getAppVersionName() {
        try {
            android.content.pm.PackageInfo packageInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            return packageInfo.versionName == null ? "1.0" : packageInfo.versionName;
        } catch (Exception ignored) {
            return "1.0";
        }
    }

    private long getAppVersionCode() {
        try {
            android.content.pm.PackageInfo packageInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return packageInfo.getLongVersionCode();
            }
            return packageInfo.versionCode;
        } catch (Exception ignored) {
            return 1L;
        }
    }

    private boolean isHomeUrl(String url) {
        if (url == null || url.isEmpty()) {
            return false;
        }
        String path = Uri.parse(url).getPath();
        if (path == null) {
            path = "";
        }
        return path.isEmpty() || path.equals("/") || path.endsWith("/admin/teacher/index.php");
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setNavigationBarColor(Color.parseColor("#1e3a5f"));
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setUseWideViewPort(false);
            settings.setLoadWithOverviewMode(false);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);

            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
            webView.setBackgroundColor(Color.parseColor("#1e3a5f"));

            // 登录态 Cookie 全量持久化：App 退出或隔天打开不丢失
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);
            webView.addJavascriptInterface(new TeacherNativeBridge(), "TeacherNative");

            // 应用内接管 APK 下载，直接唤起系统安装，不跳出浏览器
            webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    if (url != null && (url.toLowerCase().endsWith(".apk") || url.toLowerCase().contains(".apk?"))) {
                        downloadAndInstallApk(url, "最新版");
                        return;
                    }
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });

            getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (url != null && !url.startsWith("data:")) {
                        mainFrameRetryCount = 0;
                    }
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request != null && request.isForMainFrame()) {
                        int errorCode = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && error != null) ? error.getErrorCode() : -1;
                        CharSequence desc = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && error != null) ? error.getDescription() : "";
                        String failingUrl = (request.getUrl() != null) ? request.getUrl().toString() : "";
                        handleMainFrameError(view, errorCode, desc != null ? desc.toString() : "", failingUrl);
                        return;
                    }
                    super.onReceivedError(view, request, error);
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    String currentUrl = view.getUrl();
                    if (failingUrl != null && failingUrl.equals(currentUrl)) {
                        handleMainFrameError(view, errorCode, description, failingUrl);
                        return;
                    }
                    super.onReceivedError(view, errorCode, description, failingUrl);
                }
                // 证书错误一律交由系统默认处理（取消连接并走错误/重试页），
                // 不做任何放行：教学系统使用受信 CA 证书，放行等于向中间人暴露管理员凭据
            });

            String appVersionName = getAppVersionName();
            long appVersionCode = getAppVersionCode();
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    view.clearFocus();
                    view.evaluateJavascript(buildEnhanceJs(appVersionName, appVersionCode), null);
                    CookieManager.getInstance().flush();
                }
            });
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    private class TeacherNativeBridge {

        @JavascriptInterface
        public String getVersionName() {
            return MainActivity.this.getAppVersionName();
        }

        @JavascriptInterface
        public long getVersionCode() {
            return MainActivity.this.getAppVersionCode();
        }

        @JavascriptInterface
        public void setNavigationBarColor(String color) {
            try {
                final int parsed = Color.parseColor(color);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            getWindow().setNavigationBarColor(parsed);
                        }
                    }
                });
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String url, String versionName) {
            MainActivity.this.downloadAndInstallApk(url, versionName);
        }
    }

    public void downloadAndInstallApk(String downloadUrl, String versionName) {
        runOnUiThread(() -> {
            if (isDownloadingApk) {
                Toast.makeText(this, "正在下载更新中，请稍候…", Toast.LENGTH_SHORT).show();
                return;
            }

            if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
                Toast.makeText(this, "下载链接无效", Toast.LENGTH_SHORT).show();
                return;
            }

            String finalUrl = downloadUrl.trim();
            if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
                finalUrl = HOME_URL.replaceAll("/admin/teacher/index\\.php$", "") + (finalUrl.startsWith("/") ? "" : "/") + finalUrl;
            }

            showDownloadProgressDialog(finalUrl, versionName);
        });
    }

    private void showDownloadProgressDialog(String apkUrl, String versionName) {
        int density = Math.round(getResources().getDisplayMetrics().density);
        int padding = 20 * density;

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(padding, 14 * density, padding, 8 * density);

        TextView infoText = new TextView(this);
        String label = (versionName != null && !versionName.trim().isEmpty() && !versionName.equals("最新版"))
            ? "正在下载新版本 v" + versionName + " 安装包…"
            : "正在下载最新版安装包…";
        infoText.setText(label);
        infoText.setTextSize(13.5f);
        infoText.setTextColor(Color.parseColor("#475569"));
        layout.addView(infoText);

        ProgressBar progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        progressBar.setIndeterminate(false);
        LinearLayout.LayoutParams pbParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        pbParams.topMargin = 16 * density;
        pbParams.bottomMargin = 8 * density;
        layout.addView(progressBar, pbParams);

        TextView progressText = new TextView(this);
        progressText.setText("0% (0MB / 计算中…)");
        progressText.setTextSize(12);
        progressText.setTextColor(Color.parseColor("#64748b"));
        progressText.setGravity(android.view.Gravity.END);
        layout.addView(progressText);

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle("应用更新中")
            .setView(layout)
            .setCancelable(false)
            .setNegativeButton("取消下载", (dialog, which) -> {
                cancelDownload();
            });

        downloadDialog = builder.create();
        downloadDialog.show();
        isDownloadingApk = true;

        downloadThread = new Thread(() -> {
            runDownloadLoop(apkUrl, progressBar, progressText);
        });
        downloadThread.start();
    }

    private void cancelDownload() {
        isDownloadingApk = false;
        if (downloadThread != null) {
            downloadThread.interrupt();
            downloadThread = null;
        }
        if (downloadDialog != null && downloadDialog.isShowing()) {
            downloadDialog.dismiss();
        }
        Toast.makeText(this, "更新下载已取消", Toast.LENGTH_SHORT).show();
    }

    private void runDownloadLoop(String apkUrl, ProgressBar progressBar, TextView progressText) {
        InputStream in = null;
        FileOutputStream out = null;
        HttpURLConnection conn = null;
        try {
            URL url = new URL(apkUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();

            int responseCode = conn.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new Exception("HTTP " + responseCode);
            }

            int totalBytes = conn.getContentLength();
            in = conn.getInputStream();

            File downloadDir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir == null) {
                downloadDir = getExternalCacheDir();
            }
            if (downloadDir == null) {
                downloadDir = getCacheDir();
            }
            File apkFile = new File(downloadDir, "teacher_update.apk");
            if (apkFile.exists()) {
                apkFile.delete();
            }
            out = new FileOutputStream(apkFile);

            byte[] buffer = new byte[8192];
            int bytesRead;
            long downloaded = 0;
            long lastUpdateUI = 0;

            while ((bytesRead = in.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) {
                    apkFile.delete();
                    return;
                }
                out.write(buffer, 0, bytesRead);
                downloaded += bytesRead;

                long now = System.currentTimeMillis();
                if (now - lastUpdateUI > 120 || downloaded == totalBytes) {
                    lastUpdateUI = now;
                    final int progress = totalBytes > 0 ? (int) ((downloaded * 100) / totalBytes) : 0;
                    final long currentDl = downloaded;
                    final int total = totalBytes;
                    runOnUiThread(() -> {
                        if (downloadDialog != null && downloadDialog.isShowing()) {
                            progressBar.setProgress(progress);
                            String currentMb = String.format(java.util.Locale.US, "%.1fMB", currentDl / (1024f * 1024f));
                            String totalMb = total > 0 ? String.format(java.util.Locale.US, "%.1fMB", total / (1024f * 1024f)) : "未知";
                            progressText.setText(progress + "% (" + currentMb + " / " + totalMb + ")");
                        }
                    });
                }
            }
            out.flush();

            runOnUiThread(() -> {
                isDownloadingApk = false;
                if (downloadDialog != null && downloadDialog.isShowing()) {
                    downloadDialog.dismiss();
                }
                installApkDirectly(apkFile);
            });

        } catch (Exception e) {
            if (!Thread.currentThread().isInterrupted()) {
                runOnUiThread(() -> {
                    isDownloadingApk = false;
                    if (downloadDialog != null && downloadDialog.isShowing()) {
                        downloadDialog.dismiss();
                    }
                    Toast.makeText(this, "下载更新失败，请重试或检查网络", Toast.LENGTH_SHORT).show();
                });
            }
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) {}
            try { if (out != null) out.close(); } catch (Exception ignored) {}
            if (conn != null) conn.disconnect();
        }
    }

    private void installApkDirectly(File apkFile) {
        if (apkFile == null || !apkFile.exists()) {
            Toast.makeText(this, "安装包不存在", Toast.LENGTH_SHORT).show();
            return;
        }

        pendingInstallApkFile = apkFile;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            boolean canInstall = getPackageManager().canRequestPackageInstalls();
            if (!canInstall) {
                Toast.makeText(this, "请允许「安装未知应用」权限以继续更新", Toast.LENGTH_LONG).show();
                Uri packageUri = Uri.parse("package:" + getPackageName());
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, packageUri);
                startActivityForResult(intent, REQUEST_CODE_INSTALL_PERMISSION);
                return;
            }
        }

        executeInstallIntent(apkFile);
    }

    private void executeInstallIntent(File apkFile) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Uri apkUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                apkUri = FileProvider.getUriForFile(
                    this,
                    getPackageName() + ".fileprovider",
                    apkFile
                );
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                try {
                    android.content.pm.PackageManager pm = getPackageManager();
                    java.util.List<android.content.pm.ResolveInfo> resolveInfoList = pm.queryIntentActivities(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
                    for (android.content.pm.ResolveInfo resolveInfo : resolveInfoList) {
                        String targetPkg = resolveInfo.activityInfo.packageName;
                        grantUriPermission(targetPkg, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    }
                } catch (Exception ignored) {}
            } else {
                apkUri = Uri.fromFile(apkFile);
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            }

            startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "调起系统安装器失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_INSTALL_PERMISSION) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (getPackageManager().canRequestPackageInstalls()) {
                    if (pendingInstallApkFile != null && pendingInstallApkFile.exists()) {
                        executeInstallIntent(pendingInstallApkFile);
                    }
                } else {
                    Toast.makeText(this, "未授予安装权限，更新已取消", Toast.LENGTH_SHORT).show();
                }
            }
        }
    }

    @Override
    public void onBackPressed() {
        long currentTime = System.currentTimeMillis();

        // 壳层 JS 已注册 backButton 监听时由 Capacitor 分发到 JS，本方法只兜底
        if (currentTime - lastBackPressTime < 1800) {
            if (exitToast != null) {
                exitToast.cancel();
            }
            finishAffinity();
            return;
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            String url = webView.getUrl();
            boolean atHome = url == null || url.startsWith("data:") || isHomeUrl(url);

            if (!atHome && webView.canGoBack()) {
                webView.goBack();
                return;
            }
        }

        lastBackPressTime = currentTime;
        exitToast = Toast.makeText(this, "再按一次退出 语文素养积分教师端·教师端", Toast.LENGTH_SHORT);
        exitToast.show();
    }
}
