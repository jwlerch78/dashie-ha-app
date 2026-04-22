/* ============================================================
   Photos Page
   ============================================================ */

const PhotosPage = {
    render() {
        const p = MockData.photoSettings;

        return `
            <div class="section-header" style="margin-top: 0;">Source</div>
            <div class="card">
                ${FormFields.settingValue('Photo Source', p.source)}
                ${FormFields.settingValue('Folder', p.folder)}
                ${FormFields.settingValue('Photos Synced', p.photoCount)}
                ${FormFields.settingValue('Last Sync', p.lastSync)}
            </div>

            <div class="section-header">Slideshow Settings</div>
            <div class="card">
                <div class="card-body">
                    <div class="form-grid">
                        ${FormFields.select('Transition Time', p.transitionTime, ['3 seconds', '5 seconds', '10 seconds'])}
                        ${FormFields.select('Display Duration', p.displayDuration, ['15 seconds', '30 seconds', '60 seconds'])}
                        ${FormFields.select('Transition Style', p.transitionStyle, ['Fade', 'Slide', 'Zoom'])}
                        ${FormFields.select('Photo Order', p.photoOrder, ['Random', 'Chronological', 'Reverse Chronological'])}
                    </div>
                </div>
            </div>
        `;
    },

    topBarTitle() { return 'Photos'; },
    topBarSubtitle() { return `${MockData.photoSettings.photoCount} photos · ${MockData.photoSettings.source}`; },
};
