# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 8 — AI-assisted reconnaissance (optional system), plan §10.5 and §12.

Step 1 (01_features): 100 m analysis blocks; property-specific coverage; target + independent predictors.
Step 2 (02_train_validate): one defined target, spatial block split with buffers, baselines, small GBM,
        split-conformal interval on a separate calibration region, release gate.
Step 3 (03_scout_rank): connected gap regions ranked by an explicit, decomposed priority score.

TARGET (defined before training): mean 5 m routing-cell slope (deg; each 5 m cell = max of 1 m Horn slopes on
the HiRISE DTM) over a 100 m x 100 m block, labelled only where >= 90 % of its 5 m cells are HiRISE-supported.
PREDICTORS (independent of the HiRISE DTM): CTX 20 m slope stats, CTX relief/roughness, CTX 6 m image texture,
THEMIS night-IR DN. Nothing derived from the HiRISE DTM is used as a predictor.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))
from common import META, INTER, load_config, Grid, write_json, read_json  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402

SEED = 20261114
FEATURES = ['ctx_slope_mean', 'ctx_slope_max', 'ctx_slope_std', 'ctx_relief', 'ctx_detrended_std',
            'img_std', 'img_grad', 'img_mean', 'themis_night']


def load(name):
    with rasterio.open(os.path.join(INTER, name)) as d:
        return d.read(1).astype(float)


def blocks(a, k):
    H, W = a.shape[0] // k, a.shape[1] // k
    return a[:H * k, :W * k].reshape(H, k, W, k).transpose(0, 2, 1, 3).reshape(H, W, k * k)


def features(cfg):
    B = int(cfg['recon']['block_m'])
    prov = load('provenance_5m.tif')
    s5 = load('slope_5m.tif')
    sc = load('slope_ctx_20m.tif')
    zc = load('dtm_ctx_20m.tif')
    img = load('ortho_ctx_6m.tif')
    img[img == 0] = np.nan
    th_path = os.path.join(INTER, 'themis_nightir_20m.tif')
    th = load('themis_nightir_20m.tif') if os.path.exists(th_path) else np.full_like(zc, np.nan)
    th[th == 0] = np.nan
    # 6 m imagery: 100 m is not a multiple of 6 m -> resample image texture onto the 20 m lattice first
    gy, gx = np.gradient(img)
    grad = np.hypot(gx, gy)
    from scipy.ndimage import zoom
    def to20(a):
        z = zoom(np.nan_to_num(a, nan=-9999.0), 6 / 20, order=0)
        z[z == -9999.0] = np.nan
        return z[:zc.shape[0], :zc.shape[1]]
    img20, grad20 = to20(img), to20(grad)
    # local image std at 20 m from 6 m pixels (approximate 3x3 neighbourhood at 6 m)
    from scipy.ndimage import generic_filter
    istd = generic_filter(np.nan_to_num(img, nan=np.nanmean(img)), np.std, size=4)
    istd[~np.isfinite(img)] = np.nan
    istd20 = to20(istd)

    k20, k5 = B // 20, B // 5
    out = {}
    with np.errstate(all='ignore'):
        P = blocks(prov, k5)
        S5 = blocks(s5, k5)
        hi = (P == 1)
        out['hirise_frac'] = hi.mean(axis=2)
        out['ctx_only_frac'] = (P == 2).mean(axis=2)
        out['none_frac'] = (P == 0).mean(axis=2)
        out['target'] = np.where(out['hirise_frac'] >= 0.9, np.nanmean(np.where(hi, S5, np.nan), axis=2), np.nan)
        SC, ZC = blocks(sc, k20), blocks(zc, k20)
        out['ctx_slope_mean'] = np.nanmean(SC, axis=2)
        out['ctx_slope_max'] = np.nanmax(SC, axis=2)
        out['ctx_slope_std'] = np.nanstd(SC, axis=2)
        out['ctx_relief'] = np.nanmax(ZC, axis=2) - np.nanmin(ZC, axis=2)
        yy, xx = np.mgrid[0:k20, 0:k20]
        A = np.column_stack([xx.ravel(), yy.ravel(), np.ones(k20 * k20)])
        det = np.full(out['ctx_relief'].shape, np.nan)
        for i in range(ZC.shape[0]):
            for j in range(ZC.shape[1]):
                z = ZC[i, j]
                ok = np.isfinite(z)
                if ok.sum() >= 0.8 * z.size:
                    coef, *_ = np.linalg.lstsq(A[ok], z[ok], rcond=None)
                    det[i, j] = np.std(z[ok] - A[ok] @ coef)
        out['ctx_detrended_std'] = det
        out['img_std'] = np.nanmean(blocks(istd20, k20), axis=2)
        out['img_grad'] = np.nanmean(blocks(grad20, k20), axis=2)
        out['img_mean'] = np.nanmean(blocks(img20, k20), axis=2)
        out['themis_night'] = np.nanmean(blocks(th, k20), axis=2)
        out['ctx_valid_frac'] = np.isfinite(SC).mean(axis=2)
    return out


def spatial_split(nrows, ncols, strip_blocks=5, buffer_blocks=1):
    """Vertical strips (x) of strip_blocks; test = a contiguous middle strip pair, calibration = next strip;
    1-block buffers removed between regions. Returns an int grid: 0 train, 1 calibration, 2 test, -1 buffer."""
    strip = np.arange(ncols) // strip_blocks
    ns = strip.max() + 1
    test_strips = {ns // 2 - 1, ns // 2}
    cal_strips = {ns // 2 + 1}
    lab = np.zeros(ncols, int)
    lab[np.isin(strip, list(test_strips))] = 2
    lab[np.isin(strip, list(cal_strips))] = 1
    out = lab.copy()
    for c in range(ncols):
        for d in range(-buffer_blocks, buffer_blocks + 1):
            if 0 <= c + d < ncols and lab[c + d] != lab[c]:
                out[c] = -1
    return np.tile(out, (nrows, 1)), strip


def train_validate(F, cfg):
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.linear_model import LinearRegression
    from sklearn.model_selection import GroupKFold
    nr, nc = F['target'].shape
    split, strip = spatial_split(nr, nc)
    X = np.stack([F[f] for f in FEATURES], axis=-1)
    y = F['target']
    feat_ok = np.isfinite(X).all(axis=-1)
    lab_ok = feat_ok & np.isfinite(y)
    groups = np.tile(strip, (nr, 1))

    def sel(code):
        return lab_ok & (split == code)
    tr, ca, te = sel(0), sel(1), sel(2)
    res = {'target': 'mean 5 m routing-cell slope (deg) per 100 m block, HiRISE-labelled (>=90 % support)',
           'unit': 'degree', 'features': FEATURES, 'seed': SEED,
           'split': {'scheme': '500 m vertical strips; test = 2 central strips, calibration = next strip; 100 m buffers removed',
                     'n_train': int(tr.sum()), 'n_calibration': int(ca.sum()), 'n_test': int(te.sum()),
                     'n_buffer_excluded': int((lab_ok & (split == -1)).sum()),
                     'independent_test_strips': 2, 'block_m': cfg['recon']['block_m']},
           'hyperparameters': {'model': 'GradientBoostingRegressor', 'n_estimators': 200, 'max_depth': 2, 'learning_rate': 0.05,
                               'subsample': 0.8, 'chosen': 'a priori (no tuning on validation or test)'}}
    if tr.sum() < 40 or te.sum() < 15 or ca.sum() < 10:
        res['released'] = False
        res['gate'] = f'insufficient labelled support (train {tr.sum()}, cal {ca.sum()}, test {te.sum()})'
        return res, None
    gbm = GradientBoostingRegressor(n_estimators=200, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=SEED)
    # Grouped CV on training strips (diagnostic only)
    cv = []
    g_tr = groups[tr]
    k = min(5, len(np.unique(g_tr)))
    for a, b in GroupKFold(n_splits=k).split(X[tr], y[tr], g_tr):
        m = GradientBoostingRegressor(n_estimators=200, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=SEED)
        m.fit(X[tr][a], y[tr][a])
        cv.append(float(np.mean(np.abs(m.predict(X[tr][b]) - y[tr][b]))))
    gbm.fit(X[tr], y[tr])
    lin = LinearRegression().fit(F['ctx_slope_mean'][tr].reshape(-1, 1), y[tr])

    def metrics(pred, obs):
        e = pred - obs
        return {'mae': float(np.mean(np.abs(e))), 'rmse': float(np.sqrt(np.mean(e ** 2))), 'bias': float(np.mean(e)), 'n': int(len(e))}
    yt = y[te]
    p_gbm = gbm.predict(X[te])
    res['test'] = {
        'baseline_train_mean': metrics(np.full_like(yt, y[tr].mean()), yt),
        'baseline_ctx_slope_raw': metrics(F['ctx_slope_mean'][te], yt),
        'baseline_ctx_slope_linear': metrics(lin.predict(F['ctx_slope_mean'][te].reshape(-1, 1)), yt),
        'gbm': metrics(p_gbm, yt)}
    res['grouped_cv_train_mae'] = {'folds': cv, 'mean': float(np.mean(cv))}
    # by terrain class on test
    q = np.nanpercentile(y[tr], [33, 66])
    cls = np.digitize(yt, q)
    res['test_by_terrain_tercile'] = {f'tercile_{i}': metrics(p_gbm[cls == i], yt[cls == i]) for i in range(3) if (cls == i).sum() >= 3}
    # split-conformal 80 % interval from calibration region
    r_cal = np.abs(gbm.predict(X[ca]) - y[ca])
    n = len(r_cal)
    qlev = min(1.0, np.ceil((n + 1) * 0.8) / n)
    half = float(np.quantile(r_cal, qlev, method='higher'))
    cov = float(np.mean(np.abs(p_gbm - yt) <= half))
    res['interval'] = {'method': 'split conformal (absolute residual) on a separate calibration strip', 'nominal': 0.8,
                       'half_width_deg': half, 'test_empirical_coverage': cov, 'n_calibration': int(n),
                       'caveat': 'Spatial distribution shift can invalidate calibration; coverage checked on one test region only.'}
    best_base = min(res['test'][k]['mae'] for k in res['test'] if k.startswith('baseline'))
    gain = 1 - res['test']['gbm']['mae'] / best_base
    res['improvement_over_best_baseline'] = gain
    passes = gain >= 0.10 and cov >= 0.70
    res['released'] = bool(passes)
    res['gate'] = ('PASS: >=10 % MAE improvement over best baseline on held-out strips and interval coverage >= 0.70'
                   if passes else f'FAIL: improvement {gain*100:.1f} % (need >= 10 %), coverage {cov:.2f} (need >= 0.70)')
    # Domain support: training feature range (per feature, 1st-99th percentile)
    lo = np.nanpercentile(X[tr], 1, axis=0)
    hi = np.nanpercentile(X[tr], 99, axis=0)
    in_dom = feat_ok & np.all((X >= lo) & (X <= hi), axis=-1)
    pred = np.full((nr, nc), np.nan)
    pred[feat_ok] = gbm.predict(X[feat_ok])
    res['feature_importance'] = dict(zip(FEATURES, np.round(gbm.feature_importances_, 4).tolist()))
    resid = np.full((nr, nc), np.nan)
    resid[te] = p_gbm - yt
    return res, {'pred': pred, 'in_domain': in_dom, 'split': split, 'resid_test': resid, 'half': half}


def connected(mask):
    from scipy.ndimage import label
    lab, n = label(mask, structure=np.ones((3, 3)))
    return lab, n


def main():
    cfg = load_config()
    stats = read_json(os.path.join(META, 'terrain_stats.json'))
    g5 = Grid.from_dict(stats['grid_5m'])
    B = cfg['recon']['block_m']
    F = features(cfg)
    nr, nc = F['target'].shape
    gb = Grid(g5.x0, g5.y0, float(B), nc, nr)
    res, art = train_validate(F, cfg)
    print('AI gate:', res.get('gate'), {k: round(v['mae'], 3) for k, v in res.get('test', {}).items()})

    # coverage classes per block (property-specific: elevation detail)
    cov = np.where(F['hirise_frac'] >= 0.9, 1, np.where(F['ctx_valid_frac'] >= 0.5, 2, 0))

    # Scout candidates: connected regions with incomplete detailed elevation support
    gap = F['hirise_frac'] < 0.99   # any block with >1 % of 5 m cells lacking HiRISE support
    lab, n = connected(gap)
    sites = read_json(os.path.join(META, 'sites.json'))
    stations = [s for s in sites if s['kind'] in ('station', 'depot')]
    routes = read_json(os.path.join(INTER, 'routes_local.json'))
    dr = next(r for r in routes if r['is_default'])
    rxy = np.asarray(dr.get('geometry_xy', [[sites[0]['x'], sites[0]['y']]]))
    wb = np.load(os.path.join(INTER, 'walkback_25.npy'))
    W = cfg['recon']['weights']
    regions = []
    for k in range(1, n + 1):
        cells = np.argwhere(lab == k)
        xs, ys = gb.xy(cells[:, 0], cells[:, 1])
        cx, cy = float(np.mean(xs)), float(np.mean(ys))
        d_sci = min(np.hypot(cx - s['x'], cy - s['y']) for s in stations)
        d_route = float(np.min(np.hypot(rxy[:, 0] - cx, rxy[:, 1] - cy)))
        # access proxy: median cost-to-lander (25 deg scenario) of reachable 5 m cells in the region
        acc = []
        for (r, c) in cells:
            sub = wb[r * (B // 5):(r + 1) * (B // 5), c * (B // 5):(c + 1) * (B // 5)]
            acc.extend(sub[np.isfinite(sub)].ravel().tolist())
        acc_m = float(np.median(acc)) if acc else None
        unc = None
        if art is not None and res['released']:
            unc = res['interval']['half_width_deg']
        regions.append({'id': f'R{k:02d}', 'n_blocks': int(len(cells)), 'area_m2': float(len(cells) * B * B),
                        'centroid_xy': [round(cx, 1), round(cy, 1)],
                        'bbox_xy': [float(xs.min() - B / 2), float(ys.min() - B / 2), float(xs.max() + B / 2), float(ys.max() + B / 2)],
                        'mean_hirise_frac': float(F['hirise_frac'][lab == k].mean()),
                        'mean_none_frac': float(F['none_frac'][lab == k].mean()),
                        'dist_to_science_m': float(d_sci), 'dist_to_route_m': d_route, 'access_cost_eq_m': acc_m,
                        'uncertainty_deg': unc})
    # normalise and score
    def norm(v):
        v = np.asarray(v, float)
        return (v - np.nanmin(v)) / (np.nanmax(v) - np.nanmin(v)) if np.nanmax(v) > np.nanmin(v) else np.ones_like(v)
    if regions:
        sci = np.exp(-np.array([r['dist_to_science_m'] for r in regions]) / 750.0)
        gapv = 1 - np.array([r['mean_hirise_frac'] for r in regions])
        rte = np.exp(-np.array([r['dist_to_route_m'] for r in regions]) / 500.0)
        acc = np.array([r['access_cost_eq_m'] if r['access_cost_eq_m'] is not None else np.nan for r in regions])
        accn = np.nan_to_num(norm(acc), nan=1.0)
        uncv = np.array([r['uncertainty_deg'] or 0.0 for r in regions])
        uncn = norm(uncv) if uncv.max() > 0 else np.zeros(len(regions))
        size = np.log1p([r['n_blocks'] for r in regions])
        for i, r in enumerate(regions):
            comp = {'science': W['science'] * sci[i], 'gap': W['gap'] * gapv[i], 'uncertainty': W['uncertainty'] * uncn[i],
                    'route': W['route'] * rte[i], 'access': -W['access'] * accn[i]}
            r['score_components'] = {k: round(float(v), 4) for k, v in comp.items()}
            r['priority'] = round(float(sum(comp.values())), 4)
            r['size_weight_note'] = f'log-size {size[i]:.2f} shown for context; not in score'
        regions.sort(key=lambda r: -r['priority'])
        for i, r in enumerate(regions):
            r['rank'] = i + 1

    out = {'block_grid': gb.to_dict(), 'coverage_class_legend': {'1': 'HiRISE 1 m elevation support >= 90 %',
                                                                 '2': 'CTX 20 m elevation only', '0': 'no elevation support'},
           'weights': W, 'score_formula': 'priority = w_sci*exp(-d_sci/750) + w_gap*(1-hirise_frac) + w_unc*norm(unc) '
                                          '+ w_route*exp(-d_route/500) - w_access*norm(access_cost)',
           'score_assumptions': 'All weights/normalisations are design assumptions. Access cost is the 25 deg crew-graph '
                                'cost-to-lander used as a proxy; no robot mobility model exists, so these are follow-up '
                                'candidates, not validated robot routes. Unobserved regions stay eligible when the model abstains.',
           'model': res, 'regions': regions}
    write_json(os.path.join(INTER, 'recon.json'), out)
    np.save(os.path.join(INTER, 'recon_coverage.npy'), cov)
    np.save(os.path.join(INTER, 'recon_regions.npy'), lab)
    if art is not None:
        np.save(os.path.join(INTER, 'recon_pred.npy'), art['pred'])
        np.save(os.path.join(INTER, 'recon_in_domain.npy'), art['in_domain'])
        np.save(os.path.join(INTER, 'recon_split.npy'), art['split'])
        np.save(os.path.join(INTER, 'recon_resid.npy'), art['resid_test'])
    np.save(os.path.join(INTER, 'recon_target.npy'), F['target'])
    print('regions', len(regions), 'top', [(r['id'], r['priority']) for r in regions[:5]])


if __name__ == '__main__':
    main()
