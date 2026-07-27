package com.openchamber.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Force the window background to the splash drawable at runtime. The
        // theme windowBackground does not reliably surface through Capacitor's
        // contentView, so without this the transparent WebView shows a bare
        // black surface during the ~10s bundle-eval window on cold start.
        getWindow().setBackgroundDrawableResource(R.drawable.splash_background);
        final View decor = getWindow().getDecorView();
        WebView webView = findWebView(decor);
        if (webView != null) {
            webView.setBackgroundColor(Color.TRANSPARENT);
        } else {
            decor.post(() -> {
                WebView wv = findWebView(decor);
                if (wv != null) wv.setBackgroundColor(Color.TRANSPARENT);
            });
        }
    }

    private static WebView findWebView(View root) {
        if (root instanceof WebView) {
            return (WebView) root;
        }
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) {
                    return found;
                }
            }
        }
        return null;
    }
}
