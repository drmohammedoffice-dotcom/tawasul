package com.securechat.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.os.LocaleListCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Prefer Arabic so system/Gboard can offer an Arabic IME when installed.
    try {
      AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags("ar"));
    } catch (Throwable ignored) {
      /* older devices */
    }
    super.onCreate(savedInstanceState);
    WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
    if (webView != null) {
      WebSettings settings = webView.getSettings();
      settings.setDomStorageEnabled(true);
      settings.setJavaScriptEnabled(true);
      settings.setDefaultTextEncodingName("utf-8");
    }
  }
}
