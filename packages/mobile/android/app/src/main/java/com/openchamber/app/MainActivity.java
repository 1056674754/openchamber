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
        // The splash drawable (logo + bg) is the window background so it shows
        // through the transparent view hierarchy during bundle eval. Capacitor's
        // contentView sets its own background that hides the window background,
        // so walk the tree and clear every view's background (WebView included).
        getWindow().setBackgroundDrawableResource(R.drawable.splash_background);
        final View decor = getWindow().getDecorView();
        clearBackgrounds(decor);
        // WebView may not be inflated yet at this synchronous point — re-run
        // once the view hierarchy settles so the camera-behind-WebView scan
        // path keeps working.
        decor.post(() -> clearBackgrounds(decor));
    }

    private void clearBackgrounds(View view) {
        if (view == null) return;
        view.setBackgroundColor(Color.TRANSPARENT);
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                clearBackgrounds(group.getChildAt(i));
            }
        }
    }
}
