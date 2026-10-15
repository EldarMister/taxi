package kg.taxigo.app

import android.app.AlertDialog
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.NumberPicker
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.UIManagerHelper

class AtlasNumberPickerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(AtlasNumberPickerModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class AtlasNumberPickerModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private var dialog: AlertDialog? = null
  init { context.addLifecycleEventListener(this) }
  override fun getName() = "AtlasNumberPicker"

  @ReactMethod
  fun measureOnScreen(tag: Double, callback: Callback) {
    UiThreadUtil.runOnUiThread {
      try {
        val view = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag.toInt())?.resolveView(tag.toInt())
        if (view == null || !view.isAttachedToWindow) { callback.invoke(); return@runOnUiThread }
        val position = IntArray(2)
        view.getLocationOnScreen(position)
        val density = view.resources.displayMetrics.density.toDouble()
        callback.invoke(position[0] / density, position[1] / density, view.width / density, view.height / density)
      } catch (_: Exception) { callback.invoke() }
    }
  }

  @ReactMethod
  fun open(title: String, labels: ReadableArray, values: ReadableArray, selected: String, confirm: String, cancel: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val activity = reactApplicationContext.currentActivity
      if (activity == null || activity.isFinishing || dialog?.isShowing == true || labels.size() == 0 || labels.size() != values.size()) {
        promise.resolve(null)
        return@runOnUiThread
      }
      var resolved = false
      fun finish(value: String?) { if (!resolved) { resolved = true; promise.resolve(value) } }
      val picker = NumberPicker(activity).apply {
        minValue = 0
        maxValue = labels.size() - 1
        displayedValues = Array(labels.size()) { labels.getString(it) ?: "" }
        wrapSelectorWheel = false
        descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        value = (0 until values.size()).firstOrNull { values.getString(it) == selected } ?: 0
      }
      val density = activity.resources.displayMetrics.density
      val content = LinearLayout(activity).apply {
        gravity = android.view.Gravity.CENTER
        setPadding((20 * density).toInt(), (8 * density).toInt(), (20 * density).toInt(), (8 * density).toInt())
        addView(picker, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (200 * density).toInt()))
      }
      dialog = AlertDialog.Builder(activity).setTitle(title).setView(content)
        .setPositiveButton(confirm) { _, _ -> finish(values.getString(picker.value)) }
        .setNegativeButton(cancel) { _, _ -> finish(null) }
        .create().also { sheet ->
          sheet.setOnDismissListener { finish(null); if (dialog === sheet) dialog = null }
          sheet.show()
        }
    }
  }
  override fun onHostResume() {}
  override fun onHostPause() {}
  override fun onHostDestroy() { dialog?.dismiss(); dialog = null }
  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    UiThreadUtil.runOnUiThread { dialog?.dismiss(); dialog = null }
    super.invalidate()
  }
}
