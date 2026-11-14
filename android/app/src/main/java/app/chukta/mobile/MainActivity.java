package app.chukta.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChuktaFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
