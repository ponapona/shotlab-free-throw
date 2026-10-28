"""ShotLab: timestamped, bilateral single-camera pose extraction.

Coordinates and angles are estimates; visibility is not a calibrated accuracy score.
Never use outcome labels or future frames to calculate kinematic predictors.
"""
import argparse, json, math, hashlib, subprocess, time, shutil
from pathlib import Path
import cv2
import numpy as np
import mediapipe as mp

CONFIG=json.loads((Path(__file__).resolve().parent.parent/'config/defaults.json').read_text())

NAMES = ['nose','left_eye_inner','left_eye','left_eye_outer','right_eye_inner','right_eye','right_eye_outer','left_ear','right_ear','mouth_left','mouth_right','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_pinky','right_pinky','left_index','right_index','left_thumb','right_thumb','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle','left_heel','right_heel','left_foot_index','right_foot_index']

def main():
    p=argparse.ArgumentParser()
    p.add_argument('video'); p.add_argument('--model',required=True); p.add_argument('--out',required=True)
    p.add_argument('--roi',default='0,0,1,1',help='x1,y1,x2,y2 normalized; include the entire target')
    p.add_argument('--stride',type=int,default=1); p.add_argument('--limit',type=int,default=0)
    a=p.parse_args()
    roi=list(map(float,a.roi.split(',')))
    if len(roi)!=4 or not all(math.isfinite(v) and 0<=v<=1 for v in roi) or roi[2]-roi[0]<.03 or roi[3]-roi[1]<.03: raise ValueError('Invalid ROI')
    if a.stride<1 or a.limit<0: raise ValueError('Invalid stride or limit')
    cap=cv2.VideoCapture(a.video); w=int(cap.get(3)); h=int(cap.get(4)); fps=cap.get(5)
    if not cap.isOpened() or w<=0 or h<=0 or not math.isfinite(fps) or fps<=0: raise RuntimeError('Cannot decode video metadata')
    # Actual presentation timestamps, not rounded frame-index / integer fps.
    n_frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    pts=None; timestamp_source='OpenCV decoder CAP_PROP_POS_MSEC'
    if shutil.which('ffprobe'):
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',a.video]))
        pts=[float(f['best_effort_timestamp_time']) for f in probe['frames']]
        pts=[t-pts[0] for t in pts];timestamp_source='ffprobe best_effort_timestamp_time'
    opts=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=a.model),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=CONFIG['sampling']['num_poses'],min_pose_detection_confidence=CONFIG['confidence']['detection'],min_pose_presence_confidence=CONFIG['confidence']['presence'],min_tracking_confidence=CONFIG['confidence']['tracking'])
    frames=[]; start=time.time(); i=0
    with mp.tasks.vision.PoseLandmarker.create_from_options(opts) as detector:
        while True:
            ok,frame=cap.read()
            if not ok: break
            if i%a.stride: i+=1; continue
            ts=pts[i] if pts is not None else cap.get(cv2.CAP_PROP_POS_MSEC)/1000
            if not math.isfinite(ts) or (frames and ts<=frames[-1]['t']):
                ts=i/fps;timestamp_source='frame index / nominal fps fallback; verify variable-frame-rate video'
            x1,y1,x2,y2=round(roi[0]*w),round(roi[1]*h),round(roi[2]*w),round(roi[3]*h)
            crop=frame[y1:y2,x1:x2]
            # Larger input crop helps localization but creates no new image detail.
            crop=cv2.resize(crop,(round(crop.shape[1]*CONFIG['sampling']['crop_height_px']/crop.shape[0]),CONFIG['sampling']['crop_height_px']),interpolation=cv2.INTER_CUBIC)
            rgb=cv2.cvtColor(crop,cv2.COLOR_BGR2RGB)
            r=detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(ts*1000))
            pose=None; world=None
            if r.pose_landmarks:
                pose=[[round((x1+v.x*(x2-x1))/w,6),round((y1+v.y*(y2-y1))/h,6),round(v.z*(x2-x1)/w,6),round(v.visibility,4),round(v.presence,4)] for v in r.pose_landmarks[0]]
                world=[[round(v.x,5),round(v.y,5),round(v.z,5)] for v in r.pose_world_landmarks[0]]
            frames.append({'i':i,'t':round(ts,6),'p':pose,'world':world,'ball':None})
            if len(frames)%150==0: print(f'{i}/{n_frames} frames; {time.time()-start:.1f}s',flush=True)
            i+=1
            if a.limit and i>=a.limit: break
    cap.release()
    duration=(pts[-1]+1/fps) if pts else (frames[-1]['t']+1/fps if frames else 0)
    data={'schema':'shotlab/1.0','meta':{'app_version':CONFIG['app_version'],'analysis_settings':CONFIG,'sdk_version':mp.__version__,'source_sha256':hashlib.file_digest(open(a.video,'rb'),'sha256').hexdigest(),'filename':Path(a.video).name,'width':w,'height':h,'fps':fps,'duration':duration,'n_frames':n_frames,'sample_stride':a.stride,'timestamp_source':timestamp_source,'model':'MediaPipe Pose Landmarker Heavy float16','model_sha256':hashlib.sha256(Path(a.model).read_bytes()).hexdigest(),'roi':roi,'landmark_names':NAMES,'coordinate_system':'image x right, y down; normalized to original frame; world is monocular model estimate','visibility_threshold':CONFIG['confidence']['landmark'],'filter':'causal One Euro; implemented in public/engine.mjs; raw data retained','accuracy_validated':False},'frames':frames,'shots':[]}
    Path(a.out).parent.mkdir(parents=True,exist_ok=True)
    Path(a.out).write_text(json.dumps(data,separators=(',',':'),allow_nan=False))
    print('Saved',a.out,'frames',len(frames),'detected',sum(f['p'] is not None for f in frames),flush=True)

if __name__=='__main__': main()
