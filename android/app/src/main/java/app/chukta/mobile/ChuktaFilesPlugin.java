package app.chukta.mobile;

import android.media.MediaScannerConnection;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Removes a payment QR this app saved to the gallery once it is no longer needed,
 * so paid-for QR codes don't pile up in the user's photos.
 */
@CapacitorPlugin(name = "ChuktaFiles")
public class ChuktaFilesPlugin extends Plugin {

    @PluginMethod
    public void remove(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required");
            return;
        }
        File file = new File(path.replaceFirst("^file://", ""));
        // Only ever touch files inside this app's own media folder.
        File[] roots = getContext().getExternalMediaDirs();
        boolean ours = false;
        try {
            String target = file.getCanonicalPath();
            for (File root : roots) {
                if (root != null && target.startsWith(root.getCanonicalPath() + File.separator)) ours = true;
            }
        } catch (Exception e) {
            ours = false;
        }
        if (!ours) {
            call.reject("not an app file");
            return;
        }
        boolean deleted = file.delete();
        // Re-scanning a path that no longer exists drops its entry from the gallery.
        MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, null, null);
        JSObject ret = new JSObject();
        ret.put("deleted", deleted);
        call.resolve(ret);
    }
}
