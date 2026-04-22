/* ============================================================
   Calendar Page
   ============================================================ */

const CalendarPage = {
    render() {
        const accounts = MockData.calendarAccounts;
        const calendars = MockData.calendars;
        const settings = MockData.calendarSettings;

        const accountItems = accounts.map(a => ({
            icon: true,
            color: a.color,
            iconText: a.email.charAt(0).toUpperCase(),
            title: a.email,
            count: `${a.calendars} calendars`,
        }));

        const calendarCheckboxes = calendars.map(c => ({
            checked: c.active,
            color: c.color,
            label: c.name,
            detail: c.category || '',
        }));

        return `
            <div class="section-header" style="margin-top: 0;">Connected Accounts</div>
            ${DataTable.list(accountItems)}

            <div class="section-header">Active Calendars</div>
            ${DataTable.checkboxList(calendarCheckboxes)}

            <div class="section-header">Display Options</div>
            <div class="card">
                <div class="card-body">
                    <div class="form-grid">
                        ${FormFields.select('Start Week On', settings.startWeek, ['Sunday', 'Monday', 'Saturday'])}
                        ${FormFields.select('Scroll Start Time', settings.scrollTime, ['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM'])}
                    </div>
                </div>
            </div>
        `;
    },

    topBarTitle() { return 'Calendar'; },
    topBarSubtitle() { return `${MockData.calendarAccounts.length} accounts · ${MockData.calendars.filter(c => c.active).length} active calendars`; },
    topBarActions() { return `<button class="btn btn-primary">+ Add Account</button>`; },
};
