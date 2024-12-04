"use strict";

//CSS
import "./css/header.css";
import "./css/style.css";
import $ from "jquery";
import DataTable from "datatables.net";
import "datatables.net-dt/css/dataTables.dataTables.css";
window.DataTable = DataTable;

function getContextPath() {
    var ctx = window.location.pathname.substring(0, window.location.pathname.indexOf("/", 1));
    console.log("Context path: " + ctx);
    if (ctx == "/api") return "";
    return ctx;
}

const baseUrl = getContextPath() + "/api/";
const check_code = "dashboards_no_items";

async function getDashboardProperties() {
    try {
        const response = await fetch(baseUrl + "dashboards?fields=id,lastUpdated,access&paging=false", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Error getting dashboard properties:", error);
    }
}

function performPostAndGet(baseUrl, path) {
    return new Promise((resolve, reject) => {
        fetch(baseUrl + path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
        })
            .then(response => response.json())
            .then(() => {
                let tries = 0;

                function checkForResponse() {
                    fetch(baseUrl + path, {
                        method: "GET",
                        headers: {
                            "Content-Type": "application/json",
                        },
                    })
                        .then(response => response.json())
                        .then(getData => {
                            if (Object.keys(getData).length > 0 || tries >= 10) {
                                resolve(getData);
                            } else {
                                tries++;
                                setTimeout(checkForResponse, 1000);
                            }
                        })
                        .catch(error => {
                            console.error("Error checking for response:", error);
                            reject(error);
                        });
                }

                checkForResponse();
            })
            .catch(error => {
                console.error("Error making POST request:", error);
                reject(error);
            });
    });
}

async function renderDetailsTable(detailsObject, dashboard_properties, user_is_super) {

    //Need to filter the objects which the user can delete
    if (!user_is_super) {
        detailsObject.issues = detailsObject.issues.filter((issue) => {
            const dashboard = dashboard_properties.dashboards.find((dashboard) => dashboard.id === issue.id);
            return dashboard && dashboard.access.delete;
        }
        );
    }

    //Add the last updated date to the issues
    detailsObject.issues.forEach((issue) => {
        const dashboard = dashboard_properties.dashboards.find((dashboard) => dashboard.id === issue.id);
        if (dashboard) {
            const lastUpdated = new Date(dashboard.lastUpdated);
            const now = new Date();
            const diffTime = Math.abs(now - lastUpdated);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            issue.comment = diffDays;
        } else {
            issue.comment = "Unknown";
        }
    });

    var html = "<div id='details_table'><h2>Empty dashboards</h2>";
    html += "<h3>Dashboards with no content</h3>";
    html = html + "<table id='details' class='display' width='100%'>";
    html = html + "<thead><tr><th>Dashboard name</th><th>ID</th><th>Last updated (days ago)</th><th>Delete</th><th>Select</th></thead><tbody>";
    detailsObject.issues.forEach((issue) => {
        html += "<tr>";
        html += "<td>" + issue.name + "</td>";
        html += "<td><a href='" + getContextPath() + "/dhis-web-dashboard/#/" + issue.id + "' target='_blank'>" + issue.id + "</a></td>";
        html += "<td>" + issue.comment + "</td>";
        html += "<td><button onclick='deleteSelectedDashboard(\"" + issue.id + "\")'>Delete</button></td>";
        html += "<td><input type='checkbox' class='dashboard-select' value='" + issue.id + "'></td>";
        html += "</tr>";
    });

    html = html + "</tbody></table></div>";
    return html;
}

async function runDetails(code) {
    let user_is_super = false;
    var path = "dataIntegrity/details?checks=" + code;
    try {
        user_is_super = await checkUserIsSuperUser();
        const dashboard_properties = await getDashboardProperties();
        const data = await performPostAndGet(baseUrl, path);
        const name = Object.keys(data)[0];
        var this_check = data[name];
        var this_html = await renderDetailsTable(this_check, dashboard_properties, user_is_super);
        $("#detailsReport").html(this_html);
        new DataTable("#details", { "paging": true, "searching": true, order: [[1, "desc"]] });
    } catch (error) {
        console.error("Error in runDetails:", error);
    }
}


async function deleteSelectedDashboard(uid) {
    if (confirm("Are you sure you want to delete this dashboard?")) {
        try {
            const response = await fetch(baseUrl + "dashboards/" + uid, {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                },
            });
            const json = await response.json();

            if (response.status == 200) {
                alert("Dashboard deleted");
            } else {
                alert("Error deleting dashboard: " + json.message + " (" + response.status + ")");
            }
            //Need to refresh the table
            await runDetails(check_code);

        } catch (error) {
            console.error("Error deleting dashboard:", error);
        }
    }
}

async function deleteSelectedDashboards() {
    const selectedCount = $(".dashboard-select:checked").length;
    if (confirm("You are about to delete " + selectedCount + " dashboards. This operation cannot be undone. Are you sure?")) {
        const selectedDashboards = $(".dashboard-select:checked").map((index, checkbox) => checkbox.value).get();
        const maxConcurrentRequests = 10;

        try {
            let successCount = 0;
            let failureCount = 0;
            $("#statusReport").html(`Deleting ${selectedDashboards.length} dashboards...`);
            for (let i = 0; i < selectedDashboards.length; i += maxConcurrentRequests) {
                const batch = selectedDashboards.slice(i, i + maxConcurrentRequests);
                const results = await Promise.all(batch.map(async uid => {
                    const response = await fetch(baseUrl + "dashboards/" + uid, {
                        method: "DELETE",
                        headers: {
                            "Content-Type": "application/json",
                        },
                    });
                    return response.status;
                }));

                successCount += results.filter(status => status === 200).length;
                failureCount += results.filter(status => status !== 200).length;
                //Need to update the status report with the number of remaining dashboards to delete
                $("#statusReport").html(`Working to delete ${selectedDashboards.length - successCount - failureCount} dashboards...`);
            }
            //Need to refresh the table
            $("#statusReport").html("");
            await runDetails(check_code);
            alert(`Deletion summary: ${successCount} succeeded, ${failureCount} failed`);
        } catch (error) {
            console.error("Error deleting dashboards:", error);
        }
    }
}

async function checkVersion() {
    try {
        const response = await fetch(baseUrl + "system/info");
        const data = await response.json();
        const version = data.version.split(".")[1];
        console.log("DHIS2 version:", version);
        return version >= 39;
    } catch (error) {
        console.error("Error checking DHIS2 version:", error);
        return false;
    }
}

async function checkUserIsSuperUser() {
    try {
        const response = await fetch(baseUrl + "me?fields=userRoles[id,name,authorities]");
        const data = await response.json();
        const isSuperUser = data.userRoles.some(role => role.authorities.includes("ALL"));
        return isSuperUser;
    }
    catch (error) {
        console.error("Error checking user roles:", error);
        return false;
    }
}  


async function deleteAllEmptyDashboards() {
    //Use jquery to select all of the checkboxes in the table
    $(".dashboard-select").prop("checked", true);
    deleteSelectedDashboards();
}

window.getContextPath = getContextPath;
window.deleteAllEmptyDashboards = deleteAllEmptyDashboards;
window.deleteSelectedDashboard = deleteSelectedDashboard;
window.deleteSelectedDashboards = deleteSelectedDashboards;
window.getDashboardProperties = getDashboardProperties;
window.baseUrl = baseUrl;

(async () => {
    const is_supported = await checkVersion();
    if (is_supported) {
        runDetails(check_code);
    } else {
        $("#detailsReport").html("<h2>Unsupported DHIS2 version</h2>");
    }
})();
