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
        // Camera QR scan draws behind the WebView (ML Kit startScan). Keep the
        // WebView transparent so the preview is visible when the connect UI
        // toggles the barcode-scanner-active CSS class.
        final View decor = getWindow().getDecorView();
        decor.post(() -> {
            WebView webView = findWebView(decor);
            if (webView != null) {
                webView.setBackgroundColor(Color.TRANSPARENT);
            }
        });
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
